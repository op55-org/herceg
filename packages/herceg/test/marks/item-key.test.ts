import { describe, expect, it } from "vitest";
import { geometry } from "../../src/data/geometry.ts";
import { table } from "../../src/data/table.ts";
import { area } from "../../src/marks/area.ts";
import { bar } from "../../src/marks/bar.ts";
import { candlestick } from "../../src/marks/candlestick.ts";
import { custom } from "../../src/marks/custom.ts";
import { errorbar } from "../../src/marks/errorbar.ts";
import { geopoint } from "../../src/marks/geopoint.ts";
import { line } from "../../src/marks/line.ts";
import { line3d } from "../../src/marks/line3d.ts";
import { point } from "../../src/marks/point.ts";
import { point3d } from "../../src/marks/point3d.ts";
import { region } from "../../src/marks/region.ts";
import { rug } from "../../src/marks/rug.ts";
import { rule } from "../../src/marks/rule.ts";
import { text } from "../../src/marks/text.ts";

const rows = table({
  t: [1, 2, 3],
  v: [4, 5, 6],
  low: [3, 4, 5],
  high: [5, 6, 7],
  id: ["a", "b", "c"],
  lon: [0, 10, 20],
  lat: [0, 5, 10],
});

describe("itemKey", () => {
  it("is taken by every mark whose items are rows, and kept in its spec", () => {
    const marks = [
      line(rows, { x: "t", y: "v", itemKey: "id" }),
      area(rows, { x: "t", y: "v", itemKey: "id" }),
      bar(rows, { x: "id", y: "v", itemKey: "id" }),
      point(rows, { x: "t", y: "v", itemKey: "id" }),
      rug(rows, { x: "t", itemKey: "id" }),
      errorbar(rows, { x: "t", y1: "low", y2: "high", itemKey: "id" }),
      candlestick(rows, {
        x: "t",
        open: "low",
        high: "high",
        low: "low",
        close: "v",
        itemKey: "id",
      }),
      rule(rows, { y: "v", itemKey: "id" }),
      region(rows, { x1: "low", x2: "high", itemKey: "id" }),
      text(rows, { x: "t", y: "v", label: { field: "id" }, itemKey: "id" }),
      geopoint(rows, { longitude: "lon", latitude: "lat", itemKey: "id" }),
      point3d(rows, { x: "t", y: "v", z: "low", itemKey: "id" }),
      line3d(rows, { x: "t", y: "v", z: "low", itemKey: "id" }),
      custom(rows, { x: "t", y: "v", itemKey: "id", draw: () => {} }),
    ];
    for (const mark of marks) expect(mark.spec).toMatchObject({ itemKey: "id" });
  });

  it("takes number and time fields too", () => {
    expect(point(rows, { x: "t", y: "v", itemKey: "t" }).spec.itemKey).toBe("t");
    expect(line(rows, { x: "t", y: "v" }).spec).not.toHaveProperty("itemKey");
  });

  it("refuses a field the table lacks, and shapes", () => {
    expect(() => bar(rows, { x: "id", y: "v", itemKey: "name" as never })).toThrow(
      'bar itemKey: no field "name"; the table has "t", "v", "low", "high", "id", "lon", "lat"',
    );
    const shapes = table({
      x: [1],
      y: [2],
      shape: geometry({
        coordinates: Float64Array.from([0, 0, 1, 0, 1, 1]),
        ringOffsets: Int32Array.from([0, 3]),
        polygonOffsets: Int32Array.from([0, 1]),
        geometryOffsets: Int32Array.from([0, 1]),
      }),
    });
    expect(() => line(shapes, { x: "x", y: "y", itemKey: "shape" as never })).toThrow(
      'line itemKey: field "shape" holds geometry values; expected number or time or category',
    );
  });

  it("names rows of an annotation's data, which a constant annotation has none of", () => {
    expect(() => rule({ y: 1, itemKey: "id" } as never)).toThrow(
      "rule itemKey: names the rows of the mark's data; give it data, or drop itemKey",
    );
    // A table it does not read gives it no rows either.
    const notes = table({ at: [1, 2], id: ["a", "b"] });
    for (const make of [
      () => rule(notes, { y: 1, itemKey: "id" }),
      () => region(notes, { x1: 0, x2: 1, itemKey: "id" }),
      () => text(notes, { x: 1, y: 1, label: "note", itemKey: "id" }),
    ])
      expect(make).toThrow(
        "itemKey: names the rows of the mark's data; give it data, or drop itemKey",
      );
    expect(() => rule(notes, { x: "at", itemKey: "id" })).not.toThrow();
    // Text following a mark's series reads that mark's rows, not its own.
    const spec = { type: "text", from: { mark: "l", at: "last" }, label: "end", itemKey: "id" };
    expect(() => text(spec as never)).toThrow(
      "text itemKey: names the rows of the mark's data; give it data, or drop itemKey",
    );
  });
});
