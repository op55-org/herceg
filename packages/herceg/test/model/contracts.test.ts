// The spec's contracts the engine and the Python package both keep
// (test/fixtures/contracts.json): options drawn, options refused, and
// options refused until the stream that draws them lands, each by the code,
// path, and message a user reads; and what export settings draw.
import { describe, expect } from "vitest";
import { table } from "../../src/data/table.ts";
import { estimateText } from "../../src/layout/text.ts";
import { bar } from "../../src/marks/bar.ts";
import { heatmap } from "../../src/marks/heatmap.ts";
import { line } from "../../src/marks/line.ts";
import { point } from "../../src/marks/point.ts";
import { point3d } from "../../src/marks/point3d.ts";
import { region } from "../../src/marks/region.ts";
import { rule } from "../../src/marks/rule.ts";
import { text } from "../../src/marks/text.ts";
import { ChartModel } from "../../src/model/model.ts";
import { staticCompilers } from "../../src/render/compilers.ts";
import { guidesOf } from "../../src/scene/scene.ts";
import { ChartError, chartError, errorInfo } from "../../src/spec/errors.ts";
import { type ExportSettings, planExport } from "../../src/spec/export.ts";
import { loadSpec } from "../../src/spec/load.ts";
import type { ChartSpec } from "../../src/spec/spec.ts";
import contracts from "../fixtures/contracts.json";
import { contractTest } from "../helpers/contracts.ts";

interface Case {
  contract: string;
  name: string;
  spec: object;
  pending?: string;
  code?: string;
  stage?: "load" | "draw";
  path?: string;
  message?: string;
  legend?: string[];
}

describe("spec contracts", () => {
  for (const {
    contract,
    name,
    spec,
    pending,
    code,
    stage,
    path,
    message,
    legend,
  } of contracts.cases as Case[])
    contractTest(
      `${contract}.spec`,
      () => {
        const full = {
          data: { data: { columns: contracts.data } },
          ...spec,
        } as unknown as ChartSpec;
        let reached: "load" | "draw" = "load";
        let thrown: unknown;
        let shown: string[] = [];
        try {
          const { config } = loadSpec(full);
          reached = "draw";
          const model = new ChartModel(config, undefined, ...staticCompilers());
          model.setSize(400, 200, 1);
          shown = guidesOf(model.scene(estimateText), "legend").flatMap(({ entries }) =>
            entries.map(({ label }) => label),
          );
        } catch (error) {
          thrown = error;
        }
        if (code === undefined) {
          expect(thrown).toBeUndefined();
          if (legend) expect(shown).toEqual(legend);
          return;
        }
        const info = errorInfo(chartError(thrown, "validate"));
        expect({ code: info.code, path: info.path, stage: reached }).toEqual({ code, path, stage });
        expect(info.message).toContain(message);
        if (pending) expect(info.message).toContain(`(round 2 stream ${pending} adds it)`);
      },
      name,
    );
});

describe("mark functions", () => {
  const rows = table({ t: [0, 1], v: [1, 2], region: ["eu", "us"] });
  const refusal = (make: () => unknown) => {
    try {
      make();
    } catch (error) {
      return errorInfo(chartError(error, "validate"));
    }
    throw new Error("not refused");
  };

  contractTest("text.position.at-path.factory", () => {
    expect(
      refusal(() => text(rows, { at: { x: { fraction: { field: "v" } }, y: 1 }, label: "a" })),
    ).toMatchObject({ code: "unsupported", path: "at.x.fraction" });
  });

  contractTest("mark.z-index.order.factory", () => {
    // Every mark function keeps zIndex, which the chart refuses until it paints it.
    const cells = heatmap(rows, { x: "t", y: "region", color: "v", zIndex: 2 });
    expect(cells.spec.zIndex).toBe(2);
    expect(refusal(() => new ChartModel({ marks: [cells] }))).toMatchObject({
      code: "unsupported",
      path: "marks[0].zIndex",
    });
  });

  contractTest("mark.z-index.finite.factory", () => {
    for (const zIndex of [Number.NaN, Number.POSITIVE_INFINITY])
      expect(
        refusal(() => new ChartModel({ marks: [line(rows, { x: "t", y: "v", zIndex })] })),
      ).toMatchObject({ code: "invalid-option", path: "marks[0].zIndex" });
  });

  // What a mark function throws itself, as a ChartError with a path.
  const thrown = (make: () => unknown) => {
    try {
      make();
    } catch (error) {
      expect(error).toBeInstanceOf(ChartError);
      return error as ChartError;
    }
    throw new Error("not refused");
  };

  contractTest("point.size.forms.factory", () => {
    // One size form, checked before the channels refused until stream C.
    const sized = (options: object) =>
      thrown(() => point(rows, { x: "t", y: "v", ...options } as never));
    const channel = { encode: { size: { field: "v" } } };
    expect(sized({ ...channel, radiusRange: [2, 8] })).toMatchObject({
      code: "invalid-option",
      path: "radiusRange",
      message: expect.stringContaining("point radiusRange: a size channel's scale"),
    });
    expect(sized({ ...channel, size: "v" })).toMatchObject({
      code: "invalid-option",
      path: "encode.size",
      message: expect.stringContaining("point encode.size: a size channel, and size too"),
    });
    expect(sized({ ...channel, radius: 3 })).toMatchObject({
      code: "invalid-option",
      path: "encode.size",
    });
    expect(sized({ size: { field: "v" }, radius: 3 })).toMatchObject({
      code: "invalid-option",
      path: "radius",
      message: expect.stringContaining("point radius: a constant radius or a size field"),
    });
  });

  contractTest("mark.options.malformed.factory", () => {
    // Malformed options are refused for good, before what is not drawn yet.
    const cases: [() => unknown, string][] = [
      [() => region({ x1: 0, x2: 1, strokeWidth: -1 }), "strokeWidth"],
      [() => region({ x1: 0, x2: 1, stroke: 2 as never }), "stroke"],
      [() => region({ x1: 0, x2: 1, strokeSides: ["up" as never] }), "strokeSides"],
      [() => bar(rows, { x: "region", y: "v", width: { px: -1 } }), "width.px"],
    ];
    for (const [make, path] of cases)
      expect(thrown(make)).toMatchObject({ code: "invalid-option", path });
  });

  contractTest("mark.pending.whole.factory", () => {
    // Until its stream draws it, a mark function refuses an option whole,
    // whatever its value; the validator refuses malformed values first
    // (fixture cases channel.output.*, line.labels.at, label.content.*). A
    // stream that draws one of these adds its checks to the mark function
    // and moves its case here to invalid-option at the validator's path.
    const cases: [() => unknown, string][] = [
      [() => point(rows, { x: "t", y: "v", size: { value: -1 } }), "size"],
      [() => line(rows, { x: "t", y: "v", labels: { at: "last", content: [] } }), "labels"],
      [() => line(rows, { x: { fraction: "a" as never }, y: "v" }), "x"],
    ];
    for (const [make, path] of cases)
      expect(thrown(make)).toMatchObject({ code: "unsupported", path });
  });

  contractTest("scale.settings.malformed.factory", () => {
    // The chart's settings alike, where the guide compiler refuses them.
    const lines = line(rows, { x: "t", y: "v" });
    const draw = (options: object) => () => {
      const model = new ChartModel({ marks: [lines], ...options }, undefined, ...staticCompilers());
      model.setSize(400, 200, 1);
      model.scene(estimateText);
    };
    expect(thrown(draw({ x: { padding: 0.5 } }))).toMatchObject({
      code: "invalid-option",
      path: "x.padding",
    });
    expect(thrown(draw({ y: { padding: { px: -1 } } }))).toMatchObject({
      code: "invalid-option",
      path: "y.padding.px",
    });
    expect(thrown(draw({ x: { grid: { zIndex: Number.NaN } } }))).toMatchObject({
      code: "invalid-option",
      path: "x.grid.zIndex",
    });
    expect(
      thrown(draw({ guides: [{ type: "axis", scale: "y", labels: { inside: 0 } }] })),
    ).toMatchObject({ code: "invalid-option", path: "guides[0].labels.inside" });
    expect(thrown(draw({ scales: { regions: { type: "ordinal", scope: "row" } } }))).toMatchObject({
      code: "invalid-option",
      path: "scales.regions.scope",
    });
    const named = {
      scales: { depth: { type: "linear" } },
      guides: [{ type: "axis", scale: ["depth"], place: { side: "left" } }],
    };
    expect(thrown(draw(named))).toMatchObject({ code: "invalid-option", path: "guides[0].scale" });
    // Loaded as a live chart loads them: the guide compiler comes for the
    // settings of a scale of the chart's own, which it checks first.
    const live = new ChartModel({
      marks: [lines],
      scales: { depth: { type: "linear", padding: 0.5 } },
    });
    expect(live.lacks()).toEqual([true, true]);
    expect(thrown(() => live.use(...staticCompilers()))).toMatchObject({
      code: "invalid-option",
      path: "scales.depth.padding",
    });
    // A 3D box's axes, which refuse padding for good, check it first too.
    const cloud = point3d(table({ a: [0, 1], b: [1, 2], c: [2, 3] }), { x: "a", y: "b", z: "c" });
    const box = (options: object) => () => {
      const model = new ChartModel({ marks: [cloud], ...options }, undefined, ...staticCompilers());
      model.setSize(400, 200, 1);
      model.scene(estimateText);
    };
    expect(thrown(box({ x: { padding: 0.5 } }))).toMatchObject({
      code: "invalid-option",
      path: "x.padding",
    });
    expect(thrown(box({ z: { padding: 0.1 } }))).toMatchObject({
      code: "unsupported",
      path: "z.padding",
    });
    // Scales of the chart's own beside the box are checked as any chart's.
    const depth = (padding: number) => ({ scales: { depth: { type: "linear", padding } } });
    expect(thrown(box(depth(0.5)))).toMatchObject({
      code: "invalid-option",
      path: "scales.depth.padding",
    });
    expect(thrown(box(depth(0.1)))).toMatchObject({
      code: "unsupported",
      path: "scales.depth.padding",
    });
  });

  contractTest("text.vertical-align.factory", () => {
    // Refused where the chart's options hold it, at its path.
    const lines = line(rows, { x: "t", y: "v" });
    const config = (options: object) => () => new ChartModel({ marks: [lines], ...options });
    expect(
      refusal(
        () =>
          new ChartModel({
            marks: [rule({ y: 1, label: { text: "SLO", style: { verticalAlign: "top" } } })],
          }),
      ),
    ).toMatchObject({ code: "unsupported", path: "marks[0].label.style.verticalAlign" });
    expect(
      refusal(config({ title: { text: "Latency", style: { verticalAlign: "top" } } })),
    ).toMatchObject({ path: "title.style.verticalAlign" });
    expect(
      refusal(config({ y: { style: { tickLabel: { verticalAlign: "top" } } } })),
    ).toMatchObject({ path: "y.style.tickLabel.verticalAlign" });
    expect(
      refusal(config({ theme: { style: { text: { verticalAlign: "bottom" } } } })),
    ).toMatchObject({ path: "theme.style.text.verticalAlign" });
    expect(
      refusal(
        config({
          marks: [
            bar(rows, { x: "region", y: "v", labels: { style: { verticalAlign: "middle" } } }),
          ],
        }),
      ),
    ).toMatchObject({ path: "marks[0].labels.style.verticalAlign" });
  });
});

describe("export settings", () => {
  for (const { contract, name, chart, settings, plan, code, path, message } of contracts.exports)
    contractTest(
      `${contract}.spec`,
      () => {
        const [width, height] = chart as [number, number];
        if (plan) {
          // Lengths in other units are CSS pixels as floating point makes them.
          const rounded = (value: object) =>
            JSON.parse(
              JSON.stringify(value, (_, n) => (typeof n === "number" ? Number(n.toFixed(9)) : n)),
            );
          expect(rounded(planExport(settings as ExportSettings, { width, height }))).toMatchObject(
            plan,
          );
          return;
        }
        let thrown: unknown;
        try {
          planExport(settings as ExportSettings, { width, height });
        } catch (error) {
          thrown = error;
        }
        const info = errorInfo(chartError(thrown, "validate"));
        expect({ code: info.code, path: info.path }).toEqual({ code, path });
        expect(info.message).toContain(message);
      },
      name,
    );
});
