// Titled targets in static SVG, in a page: each takes the pointer where its
// item paints, its outline included, corners and all, and nowhere else.
import { afterEach, beforeEach, describe, expect } from "vitest";
import { table } from "../../src/data/table.ts";
import { estimateText } from "../../src/layout/text.ts";
import { bar } from "../../src/marks/bar.ts";
import { point } from "../../src/marks/point.ts";
import { type ChartConfig, ChartModel } from "../../src/model/model.ts";
import { staticCompilers } from "../../src/render/compilers.ts";
import { NO_PAGE } from "../../src/render/fallbacks.ts";
import { renderSvg } from "../../src/render/svg.ts";
import { titlesOf } from "../../src/render/titles.ts";
import { contractTest } from "../helpers/contracts.ts";

let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
});

afterEach(() => {
  host.remove();
});

/**
 * `mark`'s titled SVG, in the page: the plot's pixels its targets take,
 * and how many of them its painted shapes and its targets disagree on.
 */
function reach(mark: ChartConfig["marks"][number]): { taken: number; differ: number } {
  const model = new ChartModel(
    {
      locale: "en-US",
      timeZone: "UTC",
      legend: false,
      x: { show: false, grid: false },
      y: { show: false, grid: false, domain: [0, 10] },
      marks: [mark],
    },
    NO_PAGE,
    ...staticCompilers(),
  );
  model.setSize(300, 200, 1);
  const { scene, titles } = titlesOf(model, estimateText);
  host.innerHTML = renderSvg(scene, { idPrefix: "t", titles });
  const svg = host.querySelector("svg")!;
  const targets = [...svg.querySelectorAll('[pointer-events="all"]')];
  const painted = [...svg.querySelectorAll<SVGPathElement>("g[clip-path] path")].filter(
    (path) => !targets.some((target) => target.contains(path)),
  );
  const paints = (x: number, y: number) => {
    const at = svg.createSVGPoint();
    at.x = x;
    at.y = y;
    return painted.some(
      (path) =>
        (path.getAttribute("fill") !== "none" && path.isPointInFill(at)) ||
        (path.hasAttribute("stroke") && path.isPointInStroke(at)),
    );
  };
  // The plot, inside which the drawing is clipped.
  const clip = svg.querySelector<SVGRectElement>("clipPath rect")!;
  const [x0, y0, width, height] = [clip.x, clip.y, clip.width, clip.height].map(
    (length) => length.baseVal.value,
  ) as [number, number, number, number];
  const origin = svg.getBoundingClientRect();
  let taken = 0;
  let differ = 0;
  for (let x = x0 + 0.5; x < x0 + width; x++)
    for (let y = y0 + 0.5; y < y0 + height; y++) {
      const at = document.elementFromPoint(origin.left + x, origin.top + y);
      const hit = targets.some((target) => target.contains(at));
      if (hit) taken++;
      if (hit !== paints(x, y)) differ++;
    }
  return { taken, differ };
}

describe("titles in static SVG, in a page", () => {
  contractTest("svg.titles.reach", () => {
    const one = table({ c: ["a"], v: [5] });
    const outlined = { stroke: "#000000", strokeWidth: 12 } as const;
    const marks = {
      // A triangle's corners, round as its outline joins.
      triangle: point(table({ x: [1], y: [5] }), {
        x: "x",
        y: "y",
        symbol: "triangle",
        radius: 12,
        ...outlined,
      }),
      // A bar's outline beyond its fill, all round or on one side.
      bar: bar(one, { x: "c", y: "v", ...outlined }),
      capped: bar(one, { x: "c", y: "v", strokeSides: ["top"], ...outlined }),
    };
    for (const [name, mark] of Object.entries(marks)) {
      const { taken, differ } = reach(mark);
      expect(taken, name).toBeGreaterThan(100);
      expect(differ, name).toBe(0);
    }
  });
});
