// Outlines of some sides as SVG and PDF write them: a path of open sides
// over the rectangles' fill, which closed outlines leave as one path.
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { table } from "../../src/data/table.ts";
import { SvgPath } from "../../src/draw/markup.ts";
import { sideMask, traceSides } from "../../src/draw/rect.ts";
import { bar } from "../../src/marks/bar.ts";
import { region } from "../../src/marks/region.ts";
import { renderToPDF } from "../../src/pdf.ts";
import { renderToSVG, type StaticOptions } from "../../src/render/static.ts";
import type { RectGeometry } from "../../src/scene/scene.ts";
import { contractTest } from "../helpers/contracts.ts";

const zones = table({ zone: ["North", "South", "East"], gain: [12, -7, 9] });
const chart = (marks: StaticOptions["marks"]): StaticOptions => ({
  width: 300,
  height: 200,
  legend: false,
  marks,
});

/** The `d` of each path stroked `color` in `svg`. */
const stroked = (svg: string, color: string) =>
  [...svg.matchAll(/<path ([^>]*)>/g)]
    .map((m) => m[1]!)
    .filter((attributes) => attributes.includes(`stroke="${color}"`))
    .map((attributes) => /\bd="([^"]*)"/.exec(attributes)![1]!);

describe("outlines of some sides", () => {
  it("traces drawn sides, joined where they meet", () => {
    const rects: RectGeometry = {
      kind: "rect",
      draw: undefined as never,
      key: "r",
      fill: "#000",
      fillOpacity: 1,
      rects: new Float32Array([0, 0, 10, 20]),
      count: 1,
    };
    const trace = (sides: number) => {
      const path = new SvgPath();
      traceSides(path, rects, sides);
      return path.d;
    };
    expect(trace(sideMask(["top"]))).toBe("M0 0L10 0");
    // Left and top meet at the top left corner: one stroke through it.
    expect(trace(sideMask(["left", "top"]))).toBe("M0 20L0 0L10 0");
    expect(trace(sideMask(["left", "right"]))).toBe("M10 0L10 20M0 20L0 0");
  });

  contractTest("bar.stroke-sides.spec", () => {
    // Capped bars: their fill, then a path of each bar's top, whichever way it goes.
    const svg = renderToSVG(
      chart([bar(zones, { x: "zone", y: "gain", stroke: "#ff0000", strokeSides: ["top"] })]),
    );
    const [caps] = stroked(svg, "#ff0000");
    expect(caps!.match(/M/g)).toHaveLength(3);
    expect(caps).not.toMatch(/Z|C/);
    expect(svg).toMatch(/fill="none"[^>]*stroke="#ff0000"|stroke="#ff0000"[^>]*fill="none"/);
    // Every side: one path, filled and stroked.
    const closed = renderToSVG(chart([bar(zones, { x: "zone", y: "gain", stroke: "#ff0000" })]));
    const outlined = [...closed.matchAll(/<path ([^>]*)>/g)].filter((m) =>
      m[1]!.includes('stroke="#ff0000"'),
    );
    expect(outlined).toHaveLength(1);
    expect(outlined[0]![1]).not.toContain('fill="none"');
  });

  contractTest("region.stroke.spec", () => {
    // A band across the plot outlines its two edges.
    const svg = renderToSVG(chart([region({ x1: 0.25, x2: 0.5, stroke: "#ff0000" })]));
    const [edges] = stroked(svg, "#ff0000");
    expect(edges!.match(/M/g)).toHaveLength(2);
  });

  contractTest("bar.stroke-sides.pdf", () => {
    const content = (options: StaticOptions) => {
      const pdf = Buffer.from(renderToPDF(options)).toString("latin1");
      return [...pdf.matchAll(/stream\n([\s\S]*?)\nendstream/g)]
        .map((m) => inflateSync(Buffer.from(m[1]!, "latin1")).toString("latin1"))
        .find((s) => s.includes("/Figure"))!;
    };
    const pdf = content(
      chart([bar(zones, { x: "zone", y: "gain", stroke: "#ff0000", strokeSides: ["top"] })]),
    );
    // The caps: three open strokes (m, l, then S) in the outline's color.
    const red = pdf.slice(pdf.indexOf("1 0 0 RG"));
    const caps = red.slice(0, red.indexOf("\nS\n"));
    expect(caps.match(/ m\n/g)).toHaveLength(3);
    expect(caps).not.toContain(" re\n");
  });
});
