// Paint order (scene/paint.ts) and bound positions (spec/positions.ts):
// the rules renderers and marks share.
import { describe, expect } from "vitest";
import { paintOrder } from "../../src/scene/paint.ts";
import { bindPosition } from "../../src/spec/positions.ts";
import { contractTest } from "../helpers/contracts.ts";

describe("paint order", () => {
  contractTest("paint.order.z-index", () => {
    // A y grid over the marks, an x grid under them, and a mark at -2 under both.
    expect(paintOrder([{ zIndex: -1 }, { zIndex: 1 }], [{ zIndex: 0 }, { zIndex: -2 }])).toEqual([
      { kind: "geometry", index: 1 },
      { kind: "grid", index: 0 },
      { kind: "geometry", index: 0 },
      { kind: "grid", index: 1 },
    ]);
  });

  contractTest("paint.order.ties", () => {
    // Grids before geometry at one zIndex; each as listed.
    expect(
      paintOrder([{ zIndex: 0 }, { zIndex: 0 }], [{ zIndex: 0 }, { zIndex: 0 }, { zIndex: 0 }]),
    ).toEqual([
      { kind: "grid", index: 0 },
      { kind: "grid", index: 1 },
      { kind: "geometry", index: 0 },
      { kind: "geometry", index: 1 },
      { kind: "geometry", index: 2 },
    ]);
  });
});

describe("bound positions", () => {
  contractTest("position.binding.forms", () => {
    expect(bindPosition("t", "x", "x")).toEqual({
      kind: "data",
      scale: "x",
      field: "t",
      path: "x",
      offset: 0,
    });
    expect(bindPosition(3, "y", "yRight")).toEqual({
      kind: "data",
      scale: "yRight",
      value: 3,
      path: "y",
      offset: 0,
    });
    expect(bindPosition({ field: "depth", scale: "depth", offset: 2 }, "y", "y")).toEqual({
      kind: "data",
      scale: "depth",
      field: "depth",
      path: "y",
      offset: 2,
    });
    expect(bindPosition({ data: "eu" }, "at.x", "x")).toEqual({
      kind: "data",
      scale: "x",
      value: "eu",
      path: "at.x",
      offset: 0,
    });
    expect(bindPosition({ fraction: { field: "share" } }, "x", "x")).toEqual({
      kind: "frame",
      unit: "fraction",
      frame: "plot",
      field: "share",
      path: "x",
      offset: 0,
    });
    expect(bindPosition({ px: 12, frame: "chart", offset: -4 }, "span[1]", "y")).toEqual({
      kind: "frame",
      unit: "px",
      frame: "chart",
      value: 12,
      path: "span[1]",
      offset: -4,
    });
  });
});
