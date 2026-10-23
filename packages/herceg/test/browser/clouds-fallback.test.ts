import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { table } from "../../src/data/table.ts";
import { createChart } from "../../src/dom/chart.ts";
import { point } from "../../src/marks/point.ts";
import { point3d } from "../../src/marks/point3d.ts";
import { RuleMark } from "../../src/marks/rule.ts";
import { cloudPainter } from "../../src/render/webgl.ts";
import type { Geometry } from "../../src/scene/scene.ts";
import { hasWebGL2 } from "./webgl.ts";

const gpu = it.skipIf(!hasWebGL2());

// The 3D painter fails, as a module that does not load would.
vi.mock("../../src/render/webgl3d.ts", () => ({
  deepClouds: () => {
    throw new Error("offline");
  },
}));

let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement("div");
  host.style.cssText = "width:500px;height:400px";
  document.body.append(host);
});

afterEach(() => {
  host.remove();
});

const n = 150_000;
const flat = point(
  table({
    x: Float64Array.from({ length: n }, (_, i) => i % 1000),
    y: Float64Array.from({ length: n }, (_, i) => i % 7),
  }),
  { x: "x", y: "y" },
);
const deep = point3d(
  table({
    x: Float64Array.from({ length: 30_000 }, (_, i) => Math.sin(i)),
    y: Float64Array.from({ length: 30_000 }, (_, i) => Math.cos(i)),
    z: Float64Array.from({ length: 30_000 }, (_, i) => i % 10),
  }),
  { x: "x", y: "y", z: "z" },
);

gpu("keeps drawing 2D clouds on the GPU when the 3D painter fails to load", async () => {
  const painter = cloudPainter()!;
  const before = painter.bytes;
  const chart = createChart(host, { marks: [flat] });
  await chart.loading;
  expect(painter.bytes - before).toBe(n * 16);
  // 3D points go to the CPU; the 2D painter and its uploads stay the chart's.
  chart.update({ marks: [deep] });
  chart.render();
  await chart.loading;
  expect(chart.root.querySelector("canvas")).not.toBeNull();
  chart.update({ marks: [flat] });
  chart.render();
  expect(chart.loading).toBeUndefined();
  expect(painter.bytes - before).toBe(n * 16);
  chart.destroy();
  expect(painter.bytes).toBe(before);
});

gpu("draws 2D clouds on the GPU after a 3D chart's painter failed to load", async () => {
  const painter = cloudPainter()!;
  const before = painter.bytes;
  const chart = createChart(host, { marks: [deep] });
  await chart.loading;
  chart.update({ marks: [flat] });
  chart.render();
  await chart.loading;
  expect(painter.bytes - before).toBe(n * 16);
  chart.destroy();
  expect(painter.bytes).toBe(before);
});

/** A mark whose drawing only SVG paints, as another library's might be. */
class SvgOnly extends RuleMark {
  constructor() {
    super({ type: "rule", y: 1 });
  }
  override geometry(): Geometry[] {
    const draw = { svg: () => '<g class="svg-only"></g>', size: () => 0 };
    return [{ kind: "custom", key: "svg-only", draw } as unknown as Geometry];
  }
}

gpu("draws clouds' points in SVG beside a drawing only SVG paints", async () => {
  const chart = createChart(host, { marks: [flat, new SvgOnly() as never] });
  await chart.loading;
  expect(chart.root.querySelector("canvas")).toBeNull();
  expect(chart.root.querySelector(".svg-only")).not.toBeNull();
  // Every point, as one path of circles.
  const points = [...chart.root.querySelectorAll("path")].find(
    (path) => (path.getAttribute("d")?.match(/M/g)?.length ?? 0) >= n,
  );
  expect(points).toBeDefined();
  chart.destroy();
});
