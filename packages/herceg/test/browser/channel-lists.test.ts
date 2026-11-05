// Channel lists, conditions without otherwise, and rank tests in live
// charts: drawn in SVG and on canvas as static output draws them, the key of
// a scale a list reads in the legend, series hidden from it as without the
// list, and ranks following rows streamed in.
// biome-ignore-all lint/suspicious/noThenProperty: conditions' branches, as specs name them.
import "./interactive.ts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { col } from "../../src/data/expr.ts";
import { table } from "../../src/data/table.ts";
import { type Chart, type ChartOptions, createChart } from "../../src/dom/chart.ts";
import { bar } from "../../src/marks/bar.ts";
import { line } from "../../src/marks/line.ts";
import { point } from "../../src/marks/point.ts";
import { renderToSVG } from "../../src/render/static.ts";
import { contractTest } from "../helpers/contracts.ts";

let host: HTMLDivElement;
const charts: Chart[] = [];

beforeEach(() => {
  host = document.createElement("div");
  host.style.cssText = "width:600px;height:300px";
  document.body.append(host);
});

afterEach(() => {
  for (const chart of charts.splice(0)) chart.destroy();
  host.remove();
});

const RED = "#c62828";
const AMBER = "#ff9800";
const GREY = "#90a4ae";
const WEB = "#1565c0";
const CORE = "#6a1b9a";
const GREEN = "#2e7d32";

const services = () =>
  table({
    service: ["auth", "cart", "feed", "mail", "pay"],
    p99: [5, 9, 9, 2, 7],
    errors: [0.01, 0.2, 0.03, 0.1, 0],
    tier: ["web", "web", "core", "core", "core"],
  });

async function mount(options: ChartOptions): Promise<Chart> {
  const chart = createChart(host, { errorMode: "throw", ...options });
  charts.push(chart);
  for (let loading = chart.loading; loading; loading = chart.loading) await loading;
  chart.render();
  return chart;
}

/** The fills and strokes an SVG document gives in this file's colors, in the order drawn. */
const paints = (svg: string) =>
  [...svg.matchAll(/(?:fill|stroke)="(#[0-9a-f]{6})"/g)]
    .map((match) => match[1]!)
    .filter((color) => [RED, AMBER, GREY, WEB, CORE, GREEN].includes(color));

/** How many bars each color fills: SVG draws the bars of one fill as one path, a subpath each. */
function bars(svg: string): Record<string, number> {
  const drawn = new DOMParser().parseFromString(svg, "image/svg+xml");
  const counts: Record<string, number> = {};
  for (const path of drawn.querySelectorAll("path[fill]")) {
    const fill = path.getAttribute("fill")!;
    if ([RED, AMBER, GREY].includes(fill))
      counts[fill] = (counts[fill] ?? 0) + (path.getAttribute("d")!.match(/M/g) ?? []).length;
  }
  return counts;
}

const labels = (chart: Chart) =>
  [...chart.root.querySelectorAll("svg text, button")].map((node) => node.textContent);

describe("channel lists in live charts", () => {
  const options = (): ChartOptions => ({
    scales: { tier: { type: "ordinal", map: { web: WEB, core: CORE } } },
    marks: [
      bar(services(), {
        x: "service",
        y: "p99",
        encode: {
          color: [
            { condition: { when: { top: 2, field: "p99" }, then: RED } },
            { condition: { when: col("errors").gt(0.05), then: AMBER } },
            { value: GREY },
          ],
        },
      }),
      point(services(), {
        x: "service",
        y: "errors",
        color: [
          { condition: { when: { bottom: 1, field: "p99" }, then: GREEN } },
          { field: "tier", scale: "tier" },
        ],
      }),
    ],
  });

  for (const renderer of ["svg", "canvas"] as const)
    it(`draw each item's first output as static output does (${renderer})`, async () => {
      const chart = await mount({ ...options(), renderer });
      const live = paints(chart.toSVG());
      // Bars: the two slowest red, then amber for errors, else grey; points:
      // the fastest green, else their tier's; then the tier key's swatches.
      expect(bars(chart.toSVG())).toEqual({ [GREY]: 2, [RED]: 2, [AMBER]: 1 });
      expect(live).toEqual([GREY, RED, AMBER, GREEN, WEB, CORE, WEB, CORE]);
      expect(live).toEqual(paints(renderToSVG({ ...options(), width: 600, height: 300 })));
      if (renderer === "svg") expect(paints(chart.root.innerHTML)).toEqual(live);
      // The tier scale's key, read in the points' list.
      expect(labels(chart)).toEqual(expect.arrayContaining(["web", "core"]));
    });

  contractTest(
    "channel.list.toggles.browser",
    async () => {
      const latency = () =>
        table({
          t: [0, 1, 2, 0, 1, 2],
          v: [1, 9, 2, 3, 2, 8],
          service: ["a", "a", "a", "b", "b", "b"],
        });
      const listed = await mount({
        renderer: "svg",
        marks: [
          line(latency(), {
            x: "t",
            y: "v",
            series: "service",
            encode: {
              color: [
                { condition: { when: col("v").gt(5), then: RED } },
                { series: true, scale: "color" },
              ],
            },
          }),
        ],
      });
      const other = document.body.appendChild(document.createElement("div"));
      other.style.cssText = "width:600px;height:300px";
      const alone = createChart(other, {
        renderer: "svg",
        marks: [line(latency(), { x: "t", y: "v", series: "service" })],
      });
      charts.push(alone);
      for (let loading = alone.loading; loading; loading = alone.loading) await loading;
      alone.render();
      const buttons = (chart: Chart) =>
        [...chart.root.querySelectorAll("button")].map((button) => button.textContent);
      // The strokes of series and axes, but the list's red.
      const strokes = (chart: Chart) =>
        new Set(
          [...chart.root.querySelectorAll("svg path[stroke]")]
            .map((path) => path.getAttribute("stroke"))
            .filter((stroke) => stroke !== RED),
        );
      expect(buttons(listed)).toEqual(["a", "b"]);
      expect(buttons(listed)).toEqual(buttons(alone));
      expect(paints(listed.root.innerHTML)).toContain(RED);
      const shown = strokes(alone);
      expect(strokes(listed)).toEqual(shown);
      for (const chart of [listed, alone]) {
        [...chart.root.querySelectorAll("button")]
          .find((button) => button.textContent === "b")!
          .dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
        chart.render();
      }
      expect(strokes(alone)).not.toEqual(shown);
      expect(strokes(listed)).toEqual(strokes(alone));
      other.remove();
    },
    "keep series and their toggles as the series' colors alone do",
  );

  contractTest(
    "channel.rank.streaming.browser",
    async () => {
      const stream = table({ k: ["a", "b"], v: [5, 1] });
      const chart = await mount({
        renderer: "svg",
        marks: [
          bar(stream, {
            x: "k",
            y: "v",
            encode: {
              color: [{ condition: { when: { top: 1, field: "v" }, then: RED } }, { value: GREY }],
            },
          }),
        ],
      });
      const drawn = () => bars(chart.root.querySelector("svg")!.outerHTML);
      expect(drawn()).toEqual({ [RED]: 1, [GREY]: 1 });
      stream.append({ k: ["c"], v: [7] });
      chart.render();
      expect(drawn()).toEqual({ [RED]: 1, [GREY]: 2 });
      // Ties with the nth are in.
      stream.dropFirst(1);
      stream.append({ k: ["d"], v: [7] });
      chart.render();
      expect(drawn()).toEqual({ [RED]: 2, [GREY]: 1 });
    },
    "follow rows streamed in with their rank tests",
  );
});
