import { afterEach, beforeEach, expect, it } from "vitest";
import { table } from "../../src/data/table.ts";
import { createChart } from "../../src/dom/chart.ts";
import { legend } from "../../src/guides/options.ts";
import { estimateText } from "../../src/layout/text.ts";
import { area } from "../../src/marks/area.ts";
import { bar } from "../../src/marks/bar.ts";
import { custom } from "../../src/marks/custom.ts";
import { line } from "../../src/marks/line.ts";
import { text } from "../../src/marks/text.ts";
import type { TextGeometry } from "../../src/scene/scene.ts";
import { modelOf } from "./helpers.ts";

let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement("div");
  host.style.cssText = "width:600px;height:300px";
  document.body.append(host);
});
afterEach(() => host.remove());

it.each(["svg", "canvas"] as const)(
  "paints isolated rows as round dots in %s and static SVG",
  async (renderer) => {
    const data = table({ x: [0, 1, 2, 3, 4], y: [1, NaN, 3, NaN, 5] });
    for (const mark of [
      line(data, { x: "x", y: "y", strokeWidth: 6, stroke: "#ff0000" }),
      line(data, { y: "x", x: "y", orient: "y", curve: "step", strokeWidth: 6, stroke: "#ff0000" }),
      area(data, { x: "x", y: "y", strokeWidth: 6, fill: "#ff0000", line: false }),
    ]) {
      const chart = createChart(host, {
        marks: [mark],
        renderer,
        x: { show: false, domain: [0, 6], grid: false },
        y: { show: false, domain: [0, 6], grid: false },
        theme: { tokens: { background: "transparent" } },
      });
      const model = modelOf(chart);
      const x = model.xScale()!.map(mark.spec.orient === "y" ? 3 : 2);
      const y = model.yScale()!.map(mark.spec.orient === "y" ? 2 : 3);
      const image = new Image();
      const url = URL.createObjectURL(new Blob([chart.toSVG()], { type: "image/svg+xml" }));
      try {
        image.src = url;
        await image.decode();
        const raster = document.createElement("canvas");
        raster.width = 600;
        raster.height = 300;
        raster.getContext("2d")!.drawImage(image, 0, 0);
        const canvases =
          renderer === "canvas" ? [raster, chart.root.querySelector("canvas")!] : [raster];
        for (const canvas of canvases) {
          const ratio = canvas.width / 600;
          const pixel = (dx: number, dy: number) => [
            ...canvas
              .getContext("2d")!
              .getImageData(Math.floor((x + dx) * ratio), Math.floor((y + dy) * ratio), 1, 1).data,
          ];
          expect(pixel(0, 0)).toEqual([255, 0, 0, 255]);
          expect(pixel(4, 0)).toEqual(pixel(8, 8));
          expect(pixel(0, 4)).toEqual(pixel(8, 8));
        }
        if (renderer === "svg") {
          const path = chart.root.querySelector('path[stroke="#ff0000"]') as SVGPathElement;
          expect(path).not.toBeNull();
          expect(path.isPointInStroke(new DOMPoint(x, y))).toBe(true);
        }
      } finally {
        URL.revokeObjectURL(url);
        chart.destroy();
      }
    }
  },
);

it.each(["svg", "canvas"] as const)(
  "uses surface-colored halos and honors opt out in %s",
  (renderer) => {
    const chart = createChart(host, {
      renderer,
      marks: [text({ x: 1, y: 1, label: { text: "note", style: { color: "#e06600" } } })],
    });
    // The label's halo: in SVG its group's stroke; on a canvas, what the canvas strokes.
    const halo = () => {
      if (renderer === "svg") {
        const label = chart.root.querySelector('g[fill="#e06600"]')!;
        return label.hasAttribute("stroke")
          ? [label.getAttribute("stroke"), Number(label.getAttribute("stroke-opacity"))]
          : undefined;
      }
      const label = modelOf(chart)
        .scene(estimateText)
        .panels[0]!.marks.find((mark) => mark.kind === "text") as TextGeometry;
      return label.halo && [label.halo.color, label.halo.opacity];
    };
    expect(halo()).toEqual(["#ffffff", 1]);
    chart.update({
      marks: [
        text({ x: 1, y: 1, label: { text: "note", style: { color: "#e06600" } }, halo: false }),
      ],
    });
    chart.render();
    expect(halo()).toBeUndefined();
    chart.destroy();
  },
);

it.each(["svg", "canvas"] as const)(
  "keeps category-colored bars centered with visible values in %s",
  (renderer) => {
    const data = table({
      zone: ["A", "B", "C", "D", "E", "F", "G"],
      value: [10, 20, 30, 40, 50, 60, 70],
    });
    const chart = createChart(host, {
      renderer,
      marks: [bar(data, { x: "zone", y: "value", series: "zone", labels: true })],
    });
    const model = modelOf(chart);
    const band = model.xScale()!;
    expect(chart.toSVG()).toContain(">70</text>");
    const at = model.inspect(band.map(3), model.yScale()!.map(20), "nearest-x")!;
    expect(at.points[0]!.label).toBe("D");
    expect(at.points[0]!.px).toBeCloseTo(band.map(3), 3);
    chart.destroy();
  },
);

it("breaks labels into lines in Canvas text, the legend, and the tooltip", async () => {
  const data = table({ x: [0, 1], y: [1, 2], s: ["North\nregion", "North\nregion"] });
  const chart = createChart(host, {
    renderer: "canvas",
    legend: true,
    theme: { tokens: { background: "transparent" } },
    marks: [
      line(data, { x: "x", y: "y", series: "s" }),
      custom({ draw: (c) => c.text(300, 150, "WWWW\nWWWW", { fill: "#000000" }) }),
    ],
  });
  try {
    await chart.loading;
    // Two lines of text on the canvas: ink at the middle of each, none between them.
    const canvas = chart.root.querySelector("canvas")!;
    const ratio = canvas.width / 600;
    const ink = (y: number) => {
      const row = canvas
        .getContext("2d")!
        .getImageData(
          Math.floor(280 * ratio),
          Math.floor(y * ratio),
          Math.ceil(40 * ratio),
          1,
        ).data;
      return row.some((value, i) => i % 4 === 3 && value > 0);
    };
    expect(ink(150 - 7.5)).toBe(true);
    expect(ink(150 + 7.5)).toBe(true);
    expect(ink(150)).toBe(false);
    // The legend's entry writes its label in lines, as static output draws it.
    const label = chart.root.querySelector<HTMLElement>("button span:last-child")!;
    expect(label.textContent).toBe("North\nregion");
    expect(getComputedStyle(label).whiteSpace).toBe("pre-line");
    expect(label.getBoundingClientRect().height).toBeGreaterThan(25);
    const model = modelOf(chart);
    const rect = chart.root.getBoundingClientRect();
    chart.root.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        clientX: rect.left + model.xScale()!.map(0),
        clientY: rect.top + model.yScale()!.map(1),
      }),
    );
    chart.render();
    const box = [...chart.root.querySelectorAll<HTMLElement>('div[aria-hidden="true"]')].find(
      (div) => div.style.display === "block",
    )!;
    const row = box.children[1] as HTMLElement;
    expect(row.textContent).toContain("North\nregion");
    expect(getComputedStyle(row).whiteSpace).toBe("pre");
  } finally {
    chart.destroy();
  }
});

it.each(["svg", "canvas"] as const)(
  "lists a mark left out of legends where a legend names its color, in %s",
  async (renderer) => {
    const data = table({ x: [0, 1, 0, 1], y: [1, 2, 3, 4], site: ["N", "N", "S", "S"] });
    const chart = createChart(host, {
      renderer,
      guides: [legend({ include: [{ mark: "curves", channel: "color" }] })],
      marks: [line(data, { x: "x", y: "y", color: "site", id: "curves", legend: false })],
    });
    try {
      await chart.loading;
      const buttons = [...chart.root.querySelectorAll("button")].map((b) => b.textContent);
      expect(buttons).toEqual(["N", "S"]);
      expect(chart.toSVG()).toContain(">S<");
    } finally {
      chart.destroy();
    }
  },
);

it("keeps a legend label's lines under its halo", async () => {
  const data = table({
    x: [0, 1, 0, 1],
    y: [1, 2, 3, 4],
    s: ["two\nlines", "two\nlines", "b", "b"],
  });
  const chart = createChart(host, {
    renderer: "svg",
    theme: { style: { legendLabel: { halo: "auto" } } },
    marks: [line(data, { x: "x", y: "y", series: "s" })],
  });
  try {
    await chart.loading;
    const label = chart.root.querySelector<HTMLElement>("button span:last-child")!;
    expect(label.textContent).toBe("two\nlines");
    expect(getComputedStyle(label).whiteSpace).toBe("pre-line");
    expect(label.style.textShadow || label.style.webkitTextStroke).not.toBe("");
  } finally {
    chart.destroy();
  }
});
