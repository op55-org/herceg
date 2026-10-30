// Zooming and panning in every placement, by each input the presets bind (a
// wheel, a pinch, keys, a drag) and reset by a double click: an input acts
// on the instances of the panel it is in, panels sharing them follow, and
// the others stay.
import { describe, expect, it } from "vitest";
import { category } from "../../../src/data/column.ts";
import { table } from "../../../src/data/table.ts";
import type { Chart } from "../../../src/dom/chart.ts";
import type { ChangeCause } from "../../../src/dom/events.ts";
import type { Axis } from "../../../src/dom/handle.ts";
import { columns, panel } from "../../../src/layout.ts";
import { line } from "../../../src/marks/line.ts";
import { pie } from "../../../src/marks/pie.ts";
import { point3d } from "../../../src/marks/point3d.ts";
import { panels } from "../../../src/model/panels.ts";
import type { InteractionSpec } from "../../../src/spec/spec.ts";
import { contractTest } from "../../helpers/contracts.ts";
import {
  drag,
  expectFollowed,
  expectFrom,
  heard,
  instancesOf,
  key,
  mount,
  panelOf,
  placements,
  pointer,
  rows,
  viewsOf,
  wheel,
  within,
} from "./helpers.ts";

type Input = (chart: Chart, target: string) => void;

/** Two touches in panel `key`, moving apart. */
function pinch(chart: Chart, key: string): void {
  const [x, y] = within(chart, key, 0.4, 0.4);
  const fingers = [
    { pointerId: 21, isPrimary: true, side: -1 },
    { pointerId: 22, isPrimary: false, side: 1 },
  ];
  const at = (side: number, apart: number) => [x + side * apart, y + side * apart] as const;
  for (const { side, ...init } of fingers)
    pointer(chart, "pointerdown", ...at(side, 10), { pointerType: "touch", ...init });
  for (const apart of [20, 30])
    for (const { side, ...init } of fingers)
      pointer(chart, "pointermove", ...at(side, apart), { pointerType: "touch", ...init });
  for (const { side, ...init } of fingers)
    pointer(chart, "pointerup", ...at(side, 30), { pointerType: "touch", ...init });
}

/** Moves the keyboard cursor into panel `key` (in reading order from the first), then presses `name`. */
function keyIn(chart: Chart, target: string, name: string): void {
  const hovers = heard(chart, "hover");
  const panelNow = () => hovers.at(-1)?.inspection?.panel ?? "";
  chart.root.focus();
  key(chart, "Home");
  for (let i = 0; i < 4 && panelNow() !== target; i++) key(chart, "ArrowDown");
  expect(panelNow()).toBe(target);
  key(chart, name);
}

function doubleClick(chart: Chart, x: number, y: number): void {
  const rect = chart.root.getBoundingClientRect();
  chart.root.dispatchEvent(
    new MouseEvent("dblclick", {
      bubbles: true,
      cancelable: true,
      clientX: rect.left + x,
      clientY: rect.top + y,
    }),
  );
}

/**
 * Each cell: its settings, and the inputs its presets bind, each with the
 * axes it moves and the cause it reports. Between them a double click in
 * the panel resets what the input moved.
 */
const CELLS: {
  capability: string;
  interaction: InteractionSpec;
  inputs: { name: string; axes: Axis[]; cause: ChangeCause; act: Input }[];
}[] = [
  ...(["x", "y", "xy"] as const).map((zoom) => {
    const axes = [...zoom] as Axis[];
    return {
      capability: `zoom-${zoom}`,
      interaction: { zoom },
      inputs: [
        {
          name: "wheel",
          axes,
          cause: "wheel" as const,
          act: (chart: Chart, target: string) => wheel(chart, ...within(chart, target, 0.4, 0.4)),
        },
        { name: "pinch", axes, cause: "pointer" as const, act: pinch },
        {
          name: "+ key",
          axes,
          cause: "keyboard" as const,
          act: (chart: Chart, target: string) => keyIn(chart, target, "+"),
        },
      ],
    };
  }),
  ...(["x", "y", "xy"] as const).map((pan) => {
    const axes = [...pan] as Axis[];
    const dragged: Input = (chart, target) => {
      const [x, y] = within(chart, target);
      const [dx, dy] = [pan.includes("x") ? -40 : 0, pan.includes("y") ? 30 : 0];
      drag(chart, [
        [x, y],
        [x + dx / 2, y + dy / 2],
        [x + dx, y + dy],
      ]);
    };
    return {
      capability: `pan-${pan}`,
      interaction: { pan },
      inputs: [
        { name: "drag", axes, cause: "pointer" as const, act: dragged },
        // A sideways wheel pans x, where panning goes along it.
        ...(pan === "y"
          ? []
          : [
              {
                name: "sideways wheel",
                axes: ["x"] as Axis[],
                cause: "wheel" as const,
                act: (chart: Chart, target: string) =>
                  wheel(chart, ...within(chart, target), { ctrl: false, dx: 120 }),
              },
            ]),
      ],
    };
  }),
];

describe("zoom and pan in each placement", () => {
  for (const { capability, interaction, inputs } of CELLS)
    for (const placement of placements())
      contractTest(
        `interaction.${capability}.${placement.name}.engine`,
        async () => {
          const { target } = placement;
          const chart = await mount(placement.options(interaction));
          // Views of the other panels' own y scales, which no input in
          // the target, nor its reset, may change.
          const own = panelOf(chart, target).y?.instance;
          for (const { key, y } of chart.getPanels())
            if (y && key !== target && y.instance !== own) {
              const [d0, d1] = y.domain;
              chart.setViewport({ y: [d0 + (d1 - d0) / 4, d1 - (d1 - d0) / 4] }, { panel: key });
            }
          const before = viewsOf(chart);
          if (target) expect([...before.values()].some(({ y }) => y !== null)).toBe(true);
          for (const { name, axes, cause, act } of inputs) {
            const events = heard(chart, "viewport");
            act(chart, target);
            expect(events.length, name).toBeGreaterThan(0);
            expectFollowed(chart, target, axes, before);
            expectFrom(chart, events, target, cause);
            // A double click in the panel takes its scales back, and so
            // those of every panel sharing them; the others keep theirs.
            const resets = heard(chart, "viewport");
            doubleClick(chart, ...within(chart, target));
            chart.render();
            expect(viewsOf(chart), `${name}, reset`).toEqual(before);
            expectFrom(chart, resets, target, "pointer");
          }
        },
        `${capability} in ${placement.name}: the input's panel and those sharing its scales move, the others stay`,
      );
});

describe("zoom and pan variants", () => {
  contractTest(
    "interaction.zoom-y.subplots.shared-y.engine",
    async () => {
      const [, subplots] = placements();
      const chart = await mount(subplots!.options({ zoom: "y" }, { y: { scope: "chart" } }));
      const events = heard(chart, "viewport");
      wheel(chart, ...within(chart, "b", 0.5, 0.3));
      // One change of the y both panels share, listing both, once.
      expect(events).toHaveLength(1);
      expect(events[0]!.scales.map(({ scale, panels }) => [scale, panels])).toEqual([
        ["y", ["a", "b"]],
      ]);
      expect(chart.getViewport({ panel: "a" }).y).toEqual(chart.getViewport({ panel: "b" }).y);
      expectFollowed(chart, "b", ["y"]);
    },
    "a y the subplots share zooms once, in both, at a wheel step in one",
  );

  contractTest(
    "interaction.zoom-y.subplots.right-y.engine",
    async () => {
      const data = rows();
      const chart = await mount({
        marks: [
          line(data, { x: "t", y: "v", panel: "a" }),
          line(data, { x: "t", y: "v", panel: "b" }),
          line(data, { x: "t", y: "w", panel: "b", axis: "right" }),
        ],
        panels: panels(columns([1, 1], [panel("a"), panel("b")])),
        interaction: { zoom: "y" },
      });
      const [px, py] = within(chart, "b", 0.5, 0.3);
      const under = (axis: "y" | "yRight") => chart.fromPixel(py, { panel: "b", axis })!;
      const before = [under("y"), under("yRight")];
      const events = heard(chart, "viewport");
      wheel(chart, px, py);
      chart.render();
      // Both of the panel's y axes zoom about the pixel under the pointer.
      expect(under("y")).toBeCloseTo(before[0]!, 6);
      expect(under("yRight")).toBeCloseTo(before[1]!, 6);
      const view = chart.getViewport({ panel: "b" });
      expect(view.y).not.toBeNull();
      expect(view.yRight).not.toBeNull();
      expect(chart.getViewport({ panel: "a" })).toEqual({ x: null, y: null, yRight: null });
      expect(events.flatMap(({ scales }) => scales.map(({ scale }) => scale)).sort()).toEqual([
        "y",
        "yRight",
      ]);
      expectFrom(chart, events, "b", "wheel");
    },
    "a wheel step in a subplot with a right axis zooms both its y axes through the same pixel",
  );

  contractTest(
    "interaction.zoom-y.chart.right-log.engine",
    async () => {
      const chart = await mount({
        marks: [line(rows(), { x: "t", y: "w", axis: "right" })],
        yRight: { type: "log" },
        interaction: { zoom: "y" },
      });
      const [px, py] = within(chart, "", 0.5, 0.3);
      const before = chart.fromPixel(py, { axis: "yRight" })!;
      const event = wheel(chart, px, py);
      chart.render();
      expect(event.defaultPrevented).toBe(true);
      expect(chart.getViewport().yRight).not.toBeNull();
      expect(chart.fromPixel(py, { axis: "yRight" })).toBeCloseTo(before, 6);
    },
    "a wheel step in a chart of a logarithmic right axis alone zooms it about the pointer",
  );

  for (const [variant, extra] of [
    ["log", { y: { type: "log" as const } }],
    [
      "reversed",
      { x: { domain: [9, 0] as [number, number] }, y: { domain: [40, 0] as [number, number] } },
    ],
  ] as const)
    contractTest(
      `interaction.zoom-xy.chart.${variant}.engine`,
      async () => {
        const [chartPlacement] = placements();
        const chart = await mount(chartPlacement!.options({ zoom: "xy" }, extra));
        const [px, py] = within(chart, "", 0.3, 0.6);
        const under = () => [
          chart.fromPixel(px, { panel: "", axis: "x" })!,
          chart.fromPixel(py, { panel: "", axis: "y" })!,
        ];
        const before = under();
        const ratio = (ends: readonly number[]) => Math.max(...ends) / Math.min(...ends);
        const span = ratio(panelOf(chart, "").y!.domain);
        wheel(chart, px, py);
        chart.render();
        const [x, y] = under();
        expect(x).toBeCloseTo(before[0]!, 6);
        // On a log axis, by ratios: the value under the pointer stays.
        expect(y! / before[1]!).toBeCloseTo(1, 6);
        const { domain: xs } = panelOf(chart, "").x!;
        const { domain: ys } = panelOf(chart, "").y!;
        if (variant === "reversed") {
          // Still reversed, and narrower.
          expect(xs[0]).toBeGreaterThan(xs[1]);
          expect(ys[0]).toBeGreaterThan(ys[1]);
          expect(xs[0] - xs[1]).toBeLessThan(9);
        } else {
          expect(Math.min(...ys)).toBeGreaterThan(0);
          expect(ratio(ys)).toBeLessThan(span);
        }
      },
      `zoom keeps the values under the pointer on a ${variant} axis`,
    );

  contractTest(
    "interaction.zoom-x.subplots.uneven.engine",
    async () => {
      const data = rows();
      const chart = await mount({
        marks: [
          line(data, { x: "t", y: "v", panel: "a" }),
          line(data, { x: "t", y: "w", panel: "b" }),
        ],
        panels: panels(columns([3, 1], [panel("a"), panel("b")])),
        x: { scope: "chart" },
        interaction: { zoom: "x" },
      });
      expect(panelOf(chart, "a").plot.width).toBeGreaterThan(2 * panelOf(chart, "b").plot.width);
      const [px, py] = within(chart, "b", 0.25, 0.5);
      const before = chart.fromPixel(px, { panel: "b", axis: "x" })!;
      wheel(chart, px, py);
      chart.render();
      // Through the narrow panel's own pixels, which the wide one follows.
      expect(chart.fromPixel(px, { panel: "b", axis: "x" })).toBeCloseTo(before, 6);
      expectFollowed(chart, "b", ["x"]);
    },
    "a wheel step in the narrower of uneven subplots zooms about its own pixel, and the other follows",
  );

  contractTest(
    "interaction.pan-xy.subplots.captured.engine",
    async () => {
      const [, subplots] = placements();
      const chart = await mount(subplots!.options({ pan: "xy" }));
      const events = heard(chart, "viewport");
      const [bx, by] = within(chart, "b");
      const [ax, ay] = within(chart, "a");
      // Pressed in b, then over a: the pan is b's to the end.
      drag(chart, [
        [bx, by],
        [bx - 20, by + 10],
        [ax, ay + 20],
      ]);
      expectFollowed(chart, "b", ["x", "y"]);
      expect(chart.getViewport({ panel: "a" }).y).toBeNull();
      expectFrom(chart, events, "b", "pointer");
    },
    "a pan pressed in one subplot stays in it while the pointer crosses another",
  );

  contractTest(
    "interaction.pan-x.subplots.removed.engine",
    async () => {
      const data = rows();
      const marks = [
        line(data, { x: "t", y: "v", panel: "a" }),
        line(data, { x: "t", y: "w", panel: "b" }),
      ];
      const chart = await mount({
        marks,
        panels: panels(columns([1, 1], [panel("a"), panel("b")])),
        interaction: { pan: "x" },
      });
      const a = instancesOf(chart, "a").x;
      const events = heard(chart, "viewport");
      const [x, y] = within(chart, "b");
      pointer(chart, "pointerdown", x, y);
      pointer(chart, "pointermove", x - 20, y);
      expect(chart.getViewport({ panel: "b" }).x).not.toBeNull();
      // The panel goes while it pans; moving on, the pan moves nothing else.
      chart.update({ marks: [marks[0]!], panels: panels([{ id: "a" }]) });
      chart.render();
      const after = events.length;
      pointer(chart, "pointermove", x - 40, y);
      pointer(chart, "pointerup", x - 40, y);
      chart.render();
      expect(chart.getViewport({ panel: "a" }).x).toBeNull();
      expect(chart.getPanels().map(({ key }) => key)).toEqual(["a"]);
      expect(events.slice(after).filter(({ cause }) => cause === "pointer")).toEqual([]);
      expect(instancesOf(chart, "a").x).toBe(a);
    },
    "a pan whose subplot goes mid-drag ends, moving no other panel",
  );
});

describe("charts without axes", () => {
  it("refuse a range of a scale they lack, and fit nothing with null", async () => {
    const shares = table({ k: category(["a", "b"]), v: [1, 2] });
    for (const marks of [
      [pie(shares, { category: "k", value: "v" })],
      [point3d(table({ x: [0, 1], y: [1, 0], z: [0, 1] }), { x: "x", y: "y", z: "z" })],
    ]) {
      const chart = await mount({ marks: marks as never });
      for (const scale of ["x", "y", "yRight"] as const)
        expect(() => chart.setViewport({ [scale]: [0, 1] })).toThrow(
          expect.objectContaining({ code: "unknown-reference", path: scale }),
        );
      expect(() => chart.setViewport(null)).not.toThrow();
      expect(chart.getViewport()).toEqual({ x: null, y: null, yRight: null });
    }
  });
});

describe("subplots sharing y alone", () => {
  it("pan the dragged subplot's own x and the y it shares", async () => {
    const data = rows();
    const chart = await mount({
      marks: [
        line(data, { x: "t", y: "v", panel: "now" }),
        line(data, { x: "t", y: "w", panel: "before" }),
      ],
      panels: panels(columns([1, 1], [panel("now"), panel("before")])),
      x: { scope: "panel" },
      y: { scope: { panels: ["now", "before"] } },
      interaction: { pan: "xy" },
    });
    const [x, y] = within(chart, "now");
    drag(chart, [
      [x, y],
      [x - 30, y + 20],
      [x - 60, y + 40],
    ]);
    chart.render();
    const now = chart.getViewport({ panel: "now" });
    const before = chart.getViewport({ panel: "before" });
    expect(now.x).not.toBeNull();
    expect(now.y).not.toBeNull();
    expect(before.x).toBeNull();
    expect(before.y).toEqual(now.y);
  });
});
