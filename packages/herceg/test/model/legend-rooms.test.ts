// Legends' rooms: the depth a legend takes on its side, fixed or bounded, in
// place of what it measures; a legend deeper than its room drawn whole, at
// its side's edge, reaching toward the plots.
import { describe, expect, it } from "vitest";
import { table } from "../../src/data/table.ts";
import { guideCompiler } from "../../src/guides/compile.ts";
import { legend } from "../../src/guides/options.ts";
import { estimateText } from "../../src/layout/text.ts";
import { columns, panel } from "../../src/layout.ts";
import { line } from "../../src/marks/line.ts";
import { GUIDE_KIT } from "../../src/model/guides.ts";
import { type ChartConfig, ChartModel } from "../../src/model/model.ts";
import { panels } from "../../src/model/panels.ts";
import { guidesOf, type LegendGuide, type Scene } from "../../src/scene/scene.ts";
import type { LegendOptionsSpec, Room } from "../../src/spec/guides.ts";
import type { Side } from "../../src/spec/place.ts";
import { SPEC_VERSION } from "../../src/spec/spec.ts";
import { validateSpec } from "../../src/spec/validate.ts";
import { contractTest } from "../helpers/contracts.ts";

const guides = guideCompiler(GUIDE_KIT);
const WIDTH = 640;
const HEIGHT = 400;

function scene(config: ChartConfig): Scene {
  const model = new ChartModel({ locale: "en-US", ...config }, undefined, [guides]);
  model.setSize(WIDTH, HEIGHT, 1);
  return model.scene(estimateText);
}

const sites = ["North", "South", "East", "West"] as const;
const wide = table({
  t: [0, 1, 2],
  North: [0, 1, 2],
  South: [1, 2, 3],
  East: [2, 3, 4],
  West: [3, 4, 5],
});
const marks = [line(wide, { x: "t", y: [...sites] })];
/** Each entry's left edge and row middle, as the chart's legend draws them. */
const entries = (drawn: Scene) =>
  (guidesOf(drawn, "legend") as LegendGuide[]).flatMap((g) => g.entries.map(({ x, y }) => [x, y]));
const plotOf = (drawn: Scene) => drawn.panels[0]!.plot;
/** The plots' edge on `side`, from that side of the chart. */
const inset = (drawn: Scene, side: Side) => {
  const { x, y, width, height } = plotOf(drawn);
  return { top: y, left: x, bottom: HEIGHT - (y + height), right: WIDTH - (x + width) }[side];
};

describe("legend rooms", () => {
  contractTest("legend.room", () => {
    // Explicit padding of 0: the room, the 8 px gap, then the plots.
    const at = (room?: Room, options: LegendOptionsSpec = {}) =>
      scene({
        marks,
        padding: 0,
        legend: { place: { side: "top" }, ...options, ...(room !== undefined && { room }) },
      });
    const measured = at();
    const depth = inset(measured, "top") - 8;
    expect(depth).toBeGreaterThan(10);
    expect(inset(at(30), "top")).toBe(38);
    expect(inset(at(30, { place: { side: "top", offset: 6 } }), "top")).toBe(44);
    // Bounds hold what it measures; within them it takes what it measures.
    expect(inset(at({ min: 40 }), "top")).toBe(48);
    expect(inset(at({ max: depth - 5 }), "top")).toBe(depth + 3);
    expect(inset(at({ min: 0, max: 100 }), "top")).toBe(depth + 8);
    expect(inset(at({}), "top")).toBe(depth + 8);
    // The legend stands where it would without a room, wrapped alike.
    for (const room of [30, { min: 40 }, 0]) expect(entries(at(room))).toEqual(entries(measured));
  });

  contractTest("legend.room.sides", () => {
    const at = (side: Side, room?: Room) =>
      scene({
        marks,
        padding: 0,
        legend: { place: { side }, columns: 1, ...(room !== undefined && { room }) },
      });
    for (const side of ["top", "bottom", "left", "right"] as const) {
      const measured = at(side);
      // Beside the plots a gap of 16 px with explicit padding; above and below, 8.
      const zero = at(side, 0);
      const depth = inset(measured, side) - inset(zero, side);
      expect(depth, side).toBeGreaterThan(20);
      expect(inset(at(side, 100), side) - inset(zero, side), side).toBeCloseTo(100, 6);
      expect(inset(at(side, { min: depth + 10 }), side), side).toBeCloseTo(
        inset(measured, side) + 10,
        6,
      );
      expect(inset(at(side, { max: depth - 10 }), side), side).toBeCloseTo(
        inset(measured, side) - 10,
        6,
      );
      // Deeper than its room (0 too), or shallower: drawn whole, at its side's
      // edge as without a room, reaching toward the plots past its room.
      for (const room of [0, 10, 100, { max: depth - 10 }])
        expect(entries(at(side, room)), `${side} ${JSON.stringify(room)}`).toEqual(
          entries(measured),
        );
      // With no room, the plots start nearer the side than the legend's far rows.
      if (side === "top" || side === "bottom") {
        const ys = entries(zero).map(([, y]) => y!);
        const reach = side === "top" ? Math.max(...ys) : HEIGHT - Math.min(...ys);
        expect(inset(zero, side), side).toBeLessThan(reach);
      }
    }
  });

  it("take a legend guide's room, and stack legends on one side by their rooms", () => {
    const both = (rooms: [Room, Room]) =>
      scene({
        marks,
        padding: 0,
        legend: false,
        guides: rooms.map((room, i) =>
          legend({ place: { side: "bottom" }, room, ...(i === 1 && { title: "Sites" }) }),
        ),
      });
    const ys = (drawn: Scene) =>
      (guidesOf(drawn, "legend") as LegendGuide[]).map((g) => g.entries.map(({ y }) => y));
    const base = both([20, 30]);
    // The first nearest the plots; the second at the chart's bottom edge. A
    // room moves the plots, and the legends nearer them than it, by its change.
    const first = both([40, 30]);
    expect(inset(first, "bottom") - inset(base, "bottom")).toBeCloseTo(20, 6);
    expect(ys(first)).toEqual(ys(base));
    const second = both([20, 50]);
    expect(inset(second, "bottom") - inset(base, "bottom")).toBeCloseTo(20, 6);
    expect(ys(second)[1]).toEqual(ys(base)[1]);
    expect(ys(second)[0]!.map((y, i) => y - ys(base)[0]![i]!)).toEqual(ys(base)[0]!.map(() => -20));
  });

  contractTest("legend.room.panel", () => {
    const data = table({ t: [0, 1, 0, 1], v: [1, 2, 3, 4], s: ["a", "a", "b", "b"] });
    const layout = panels(columns([1, 1], [panel({ id: "left" }), panel({ id: "right" })]));
    const at = (side: Side, room?: Room) => {
      const drawn = scene({
        marks: [
          line(data, { x: "t", y: "v", color: "s", panel: "left" }),
          line(data, { x: "t", y: "v", color: "s", panel: "right" }),
        ],
        panels: layout,
        guides: [legend({ panel: "right", place: { side }, ...(room !== undefined && { room }) })],
      });
      const own = (guidesOf(drawn, "legend") as LegendGuide[]).find((g) => g.panel === "right")!;
      const plot = drawn.panels.find((p) => p.key === "right")!.plot;
      return { plot, entries: own.entries.map(({ x, y }) => [x, y]) };
    };
    // Relative to the plot's edge on its side, which the room moves.
    const relative = (side: Side, { plot, entries }: ReturnType<typeof at>) => {
      const [x0, y0] = {
        top: [plot.x, plot.y],
        bottom: [plot.x, plot.y + plot.height],
        left: [plot.x, plot.y],
        right: [plot.x + plot.width, plot.y],
      }[side];
      return entries.map(([x, y]) => [x! - x0!, y! - y0!]);
    };
    for (const side of ["top", "bottom", "left", "right"] as const) {
      // Away from the plot, on its side.
      const away = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0] }[side];
      const zero = relative(side, at(side, 0));
      const measured = relative(side, at(side));
      const depth =
        (measured[0]![0]! - zero[0]![0]!) * away[0]! + (measured[0]![1]! - zero[0]![1]!) * away[1]!;
      expect(depth, side).toBeGreaterThan(10);
      // Drawn whole at its room's far edge from the plot, as without a room;
      // the room moves it from the plot by what it is past or short of what it measures.
      for (const room of [0, 10, 60]) {
        const roomed = relative(side, at(side, room));
        roomed.forEach(([x, y], i) => {
          expect(x, `${side} ${room}`).toBeCloseTo(zero[i]![0]! + room * away[0]!, 6);
          expect(y, `${side} ${room}`).toBeCloseTo(zero[i]![1]! + room * away[1]!, 6);
        });
      }
      // Above and below, the plots of a row keep the room (beside, columns share the width).
      if (side === "top" || side === "bottom") {
        const edge = (room?: Room) => {
          const { plot } = at(side, room);
          return side === "top" ? plot.y : -(plot.y + plot.height);
        };
        expect(edge() - edge(0), side).toBeCloseTo(depth, 6);
        expect(edge(60) - edge(0), side).toBeCloseTo(60, 6);
      }
    }
  });

  contractTest("legend.room.refused", () => {
    const refused = (config: Partial<ChartConfig>, message: string) =>
      expect(() => scene({ marks, ...config })).toThrow(message);
    const inside = "a legend inside a plot takes no room; place it on a side";
    refused(
      { legend: { place: { inside: "top-right" }, room: 30 } },
      `chart legend.room: ${inside}`,
    );
    refused(
      { guides: [legend({ place: { inside: "top-left" }, room: {} })] },
      `chart guides[0].room: ${inside}`,
    );
    // Axes' and legends' rooms are read alike; a legend not shown has its room checked all the same.
    const expected =
      "room: expected finite pixels of at least 0, or { min, max } with min no more than max; received";
    refused({ guides: [legend({ show: false, room: -4 })] }, `chart guides[0].${expected} -4`);
    refused({ legend: { room: -4 } }, `chart legend.${expected} -4`);
    refused(
      { legend: { room: { min: 50, max: 30 } } },
      `chart legend.${expected} { min: 50, max: 30 }`,
    );
    refused({ legend: { room: "auto" as never } }, `chart legend.${expected} "auto"`);
    refused(
      { legend: { room: { max: Number.NaN } } },
      `chart legend.${expected} { min: undefined, max: NaN }`,
    );
    // A list is no bounds, and a bound of null is no bound left out (it would hold nothing).
    for (const [room, received] of [
      [[40, 60], "[40,60]"],
      [{ max: null }, "{ min: undefined, max: null }"],
      [{ min: null }, "{ min: null, max: undefined }"],
    ] as const) {
      refused({ legend: { room: room as never } }, `chart legend.${expected} ${received}`);
      refused(
        { guides: [legend({ room: room as never })] },
        `chart guides[0].${expected} ${received}`,
      );
      refused(
        { guides: [legend({ show: false, room: room as never })] },
        `chart guides[0].${expected} ${received}`,
      );
      refused({ x: { room: room as never } }, `chart x.${expected} ${received}`);
    }
    // Specs say where, as the spec spells it.
    const spec = (options: object) => () =>
      validateSpec({
        version: SPEC_VERSION,
        data: { t: { columns: { t: [0], v: [1] } } },
        marks: [{ type: "line", data: "t", x: "t", y: "v" }],
        ...options,
      } as never);
    expect(spec({ legend: { place: { inside: "top-right" }, room: 30 } })).toThrow(
      `legend.room: ${inside}`,
    );
    expect(
      spec({ guides: [{ type: "legend" }, { type: "legend", place: { inside: "top" }, room: 4 }] }),
    ).toThrow(`guides[1].room: ${inside}`);
    expect(spec({ legend: { room: -4 } })).toThrow(
      "legend.room: expected a number of at least 0; received -4",
    );
    expect(spec({ legend: { room: { min: 50, max: 30 } } })).toThrow(
      "legend.room: expected finite pixels of at least 0, or { min, max } with min no more than max; received { min: 50, max: 30 }",
    );
    expect(spec({ legend: { room: "auto" } })).toThrow(
      'legend.room: expected an object; received "auto"',
    );
    expect(spec({ legend: { room: { min: 40, most: 9 } } })).toThrow(/legend\.room\.most/);
    expect(spec({ legend: { place: { side: "top" }, room: { min: 40 } } })).not.toThrow();
  });
});
