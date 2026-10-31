// Regions over a table with per-row paint (`encode`): B8's Marimekko, 24
// cells of four markets' columns, as one region mark colored by segment
// and faded by share, drawn and picked in row order.
import { describe, expect, it } from "vitest";
import { table } from "../../src/data/table.ts";
import { estimateText } from "../../src/layout/text.ts";
import { region } from "../../src/marks/region.ts";
import { type ChartConfig, ChartModel } from "../../src/model/model.ts";
import { Picker } from "../../src/model/pick.ts";
import { staticCompilers } from "../../src/render/compilers.ts";
import type { RectGeometry } from "../../src/scene/scene.ts";
import { loadSpec } from "../../src/spec/load.ts";
import { contractTest } from "../helpers/contracts.ts";
import { legendOf } from "../helpers/guides.ts";
import { pickKit } from "../helpers/picker.ts";

function build(config: ChartConfig) {
  const model = new ChartModel(
    { locale: "en-US", timeZone: "UTC", ...config },
    undefined,
    ...staticCompilers(),
  );
  model.setSize(640, 400, 1);
  return { model, scene: model.scene(estimateText) };
}

const MARKETS = ["Auburn", "Birmingham", "Evansville", "Fresno"];
const SEGMENTS = ["Veg", "Berry", "Nut", "Fruit", "Grain", "Herb"];
const COLORS = ["#1b9e77", "#d95f02", "#7570b3", "#e7298a", "#66a61e", "#e6ab02"];

/** A row per market and segment: its column (start, end) and its band of the column (bottom, top). */
function cells() {
  const market: string[] = [];
  const segment: string[] = [];
  const start: number[] = [];
  const end: number[] = [];
  const bottom: number[] = [];
  const top: number[] = [];
  const share: number[] = [];
  let x = 0;
  MARKETS.forEach((m, i) => {
    const width = 10 + i * 5;
    let y = 0;
    SEGMENTS.forEach((s, j) => {
      const part = (j + 1 + i) / SEGMENTS.reduce((n, _, k) => n + k + 1 + i, 0);
      market.push(m);
      segment.push(s);
      start.push(x);
      end.push(x + width);
      bottom.push(y);
      top.push(y + part);
      share.push(part);
      y += part;
    });
    x += width;
  });
  return table({ market, segment, start, end, bottom, top, share });
}

const marimekko = (data = cells()): ChartConfig => ({
  x: { domain: [0, 70], nice: false },
  y: { domain: [0, 1], nice: false },
  scales: {
    segments: {
      type: "ordinal",
      domain: SEGMENTS,
      map: Object.fromEntries(SEGMENTS.map((s, i) => [s, COLORS[i]!])),
    },
  },
  marks: [
    region(data, {
      id: "cells",
      x1: "start",
      x2: "end",
      y1: "bottom",
      y2: "top",
      fillOpacity: 1,
      encode: {
        fill: { field: "segment", scale: "segments" },
        opacity: { field: "share", scale: { type: "identity" } },
      },
    }),
  ],
});

describe("regions with per-row paint", () => {
  contractTest(
    "region.encode.rows",
    () => {
      const data = cells();
      const { scene } = build(marimekko(data));
      const rects = scene.panels[0]!.marks.filter((m): m is RectGeometry => m.kind === "rect");
      // One mark, 24 cells, in row order: a geometry per run of one look.
      expect(rects.reduce((n, g) => n + g.count, 0)).toBe(24);
      const looks = rects.flatMap((g) =>
        Array.from({ length: g.count }, () => [g.fill, Number(g.fillOpacity.toFixed(4))]),
      );
      const share = data.numbers("share");
      expect(looks).toEqual(
        Array.from({ length: 24 }, (_, i) => [COLORS[i % 6]!, Number(share[i]!.toFixed(4))]),
      );
      // Left to right, then bottom to top within each column, as the rows are.
      const lefts = rects.flatMap((g) =>
        Array.from({ length: g.count }, (_, k) => g.rects[k * 4]!),
      );
      expect(lefts).toEqual([...lefts].sort((a, b) => a - b));
    },
    "B8's 24 cells are one region mark, each painted from its row",
  );

  it("are picked as painted: the cell under the pointer names its row", () => {
    const { model, scene } = build(marimekko());
    const picker = new Picker(pickKit);
    const rects = scene.panels[0]!.marks.filter((m): m is RectGeometry => m.kind === "rect");
    // The middle of the 9th cell (Birmingham's Nut), wherever its run put it.
    let seen = 0;
    let box: number[] | undefined;
    for (const g of rects)
      for (let k = 0; k < g.count; k++, seen++)
        if (seen === 8) box = Array.from(g.rects.subarray(k * 4, k * 4 + 4));
    const [x, y, w, h] = box!;
    const picked = picker.pick(model, { x: x! + w! / 2, y: y! + h! / 2, slop: 4 });
    expect(picked?.key).toBe("cells");
    expect(picked?.item.part).toMatchObject({ kind: "row", position: 8 });
  });

  it("paint every row in constant channels, and rows at constant places", () => {
    const data = table({ a: [0, 2], b: [1, 3], paint: ["#00ff00", "#0000ff"] });
    const fills = (config: ChartConfig) =>
      build(config)
        .scene.panels[0]!.marks.filter((m): m is RectGeometry => m.kind === "rect")
        .map((g) => [g.fill, g.count]);
    expect(
      fills({
        x: { domain: [0, 3] },
        marks: [region(data, { x1: "a", x2: "b", encode: { fill: { value: "#ff0000" } } })],
      }),
    ).toEqual([["#ff0000", 2]]);
    // Places that read no field: a region per row all the same, in its row's paint.
    expect(
      fills({
        x: { domain: [0, 3] },
        marks: [
          region(data, {
            x1: 0,
            x2: 1,
            encode: { fill: { field: "paint", scale: { type: "identity" } } },
          }),
        ],
      }),
    ).toEqual([
      ["#00ff00", 1],
      ["#0000ff", 1],
    ]);
  });

  it("refuse channels without a table, and the series' names, which regions have none of", () => {
    expect(() => region({ x1: 0, x2: 1, encode: { fill: { value: "#000000" } } } as never)).toThrow(
      "region encode: channels read the rows of a table; give region(table, options), or drop encode",
    );
    const data = table({ a: [0, 2], b: [1, 3] });
    const series = { series: true, scale: "kinds" } as never;
    expect(() =>
      build({
        scales: { kinds: { type: "ordinal", map: { a: "#ff0000" } } },
        marks: [region(data, { x1: "a", x2: "b", encode: { fill: series } })],
      }),
    ).toThrow(
      "region (mark 0) encode.fill: regions have no series whose names it could read; give a field, a value, or a condition",
    );
    const spec = {
      data: { d: { columns: { a: [0, 2], b: [1, 3] } } },
      scales: { kinds: { type: "ordinal", map: { a: "#ff0000" } } },
      marks: [{ type: "region", data: "d", x1: "a", x2: "b", encode: { opacity: series } }],
    };
    expect(() => loadSpec(spec as never)).toThrow(
      "marks[0].encode.opacity.series: regions have no series whose names it could read; give a field, a value, or a condition",
    );
  });

  it("list rows by their labels in the legend, each in its first row's paint", () => {
    const data = table({
      a: [0, 2, 4],
      b: [1, 3, 5],
      name: ["Hot", "Cold", "Hot"],
      paint: ["#ff0000", "#0000ff", "#00ff00"],
      o: [1, 0.5, 1],
    });
    const { scene } = build({
      x: { domain: [0, 5] },
      marks: [
        region(data, {
          x1: "a",
          x2: "b",
          label: { field: "name" },
          legend: true,
          encode: {
            fill: { field: "paint", scale: { type: "identity" } },
            opacity: { field: "o", scale: { type: "identity" } },
          },
        }),
      ],
    });
    const entries = legendOf(scene);
    expect(entries.map(({ label, color }) => [label, color])).toEqual([
      ["Hot", "#ff0000"],
      ["Cold", "#0000ff"],
    ]);
    // Swatches in the region's faint fill, at each row's opacity.
    expect(
      entries.map(({ sample }) => {
        const item = sample!.items[0] as { fill: string; opacity?: number };
        return [item.fill, item.opacity];
      }),
    ).toEqual([
      ["#ff0000", 0.15],
      ["#0000ff", 0.075],
    ]);
    // Outlines in their rows' strokes, the boxes outlined.
    const outlined = build({
      x: { domain: [0, 5] },
      marks: [
        region(data, {
          x1: "a",
          x2: "b",
          fill: "none",
          label: { field: "name" },
          legend: true,
          encode: { stroke: { field: "paint", scale: { type: "identity" } } },
        }),
      ],
    });
    expect(
      legendOf(outlined.scene).map(({ sample }) => {
        const item = sample!.items[0] as { type: string; fill: string; stroke?: string };
        return [item.type, item.fill, item.stroke];
      }),
    ).toEqual([
      ["shape", "none", "#ff0000"],
      ["shape", "none", "#0000ff"],
    ]);
    // Outlines of no width, or on no side, draw none, in the legend as in the plot.
    for (const unlined of [{ strokeWidth: 0 }, { strokeSides: [] }]) {
      const { scene } = build({
        x: { domain: [0, 5] },
        marks: [
          region(data, {
            x1: "a",
            x2: "b",
            fill: "none",
            ...unlined,
            label: { field: "name" },
            legend: true,
            encode: { stroke: { field: "paint", scale: { type: "identity" } } },
          }),
        ],
      });
      expect(
        legendOf(scene).map(({ sample }) => sample!.items[0]!.type),
        JSON.stringify(unlined),
      ).toEqual(["rect", "rect"]);
    }
  });

  it("outline rows in their own stroke colors, at their opacity", () => {
    const data = table({ a: [0, 2], b: [1, 3], line: ["#ff0000", "#0000ff"], o: [0.5, 1] });
    const { scene } = build({
      x: { domain: [0, 3] },
      marks: [
        region(data, {
          x1: "a",
          x2: "b",
          encode: {
            stroke: { field: "line", scale: { type: "identity" } },
            opacity: { field: "o", scale: { type: "identity" } },
          },
        }),
      ],
    });
    const rects = scene.panels[0]!.marks.filter((m): m is RectGeometry => m.kind === "rect");
    expect(rects.map((g) => [g.edge?.stroke, g.edge?.opacity, g.fillOpacity])).toEqual([
      ["#ff0000", 0.5, 0.075],
      ["#0000ff", 1, 0.15],
    ]);
  });
});
