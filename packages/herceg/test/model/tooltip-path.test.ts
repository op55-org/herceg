// Tooltip paths: `{ path: true, separator? }`, a content and heading part
// of treemaps and sunbursts, writes a node's names from the top of the
// whole tree, each as its level's field's display writes it.
import { describe, expect, it } from "vitest";
import { table } from "../../src/data/table.ts";
import type { FieldDisplays } from "../../src/fields/rules.ts";
import { estimateText } from "../../src/layout/text.ts";
import { sunburst } from "../../src/marks/sunburst.ts";
import { tooltipWriters } from "../../src/marks/tooltip-writers.ts";
import { treemap } from "../../src/marks/treemap.ts";
import { GUIDE_KIT } from "../../src/model/guides.ts";
import { type ChartConfig, ChartModel } from "../../src/model/model.ts";
import { staticCompilers } from "../../src/render/compilers.ts";
import { loadSpec } from "../../src/spec/load.ts";
import type { ChartSpec } from "../../src/spec/spec.ts";
import { contractTest } from "../helpers/contracts.ts";

function build(config: ChartConfig) {
  const model = new ChartModel(
    { locale: "en-US", timeZone: "UTC", ...config },
    undefined,
    staticCompilers(),
  );
  model.writers = tooltipWriters;
  model.setSize(600, 400, 1);
  model.scene(estimateText);
  return model;
}

const texts = (runs: readonly { text: string }[] | undefined) => runs?.map((r) => r.text).join("");

/** A flare-like tree three levels deep, leaves at every depth. */
const classes = () =>
  table({
    level1: ["vis", "vis", "vis", "util", "util"],
    level2: ["data", "data", "events", "math", null],
    level3: ["Data", "Tuple", null, null, null],
    size: [30, 10, 20, 5, 8],
  });
const LEVELS = ["level1", "level2", "level3"] as const;

/** Each item the chart draws, by its label: its content and heading as text, and its names. */
function written(model: ChartModel) {
  const result = model.items!.result()!;
  const out = new Map<
    string,
    {
      content: string | undefined;
      heading: string | undefined;
      names: readonly string[] | undefined;
    }
  >();
  for (let i = 0; i < result.count; i++) {
    const [point] = model.inspectItem(result.item(i).key)!.points;
    out.set(point!.label, {
      content: texts(point!.content),
      heading: texts(point!.heading),
      names: point!.names,
    });
  }
  return out;
}

describe("tooltip paths", () => {
  contractTest(
    "tooltip.path",
    () => {
      for (const mark of [sunburst, treemap]) {
        const model = build({
          marks: [
            mark(classes(), {
              path: LEVELS,
              value: "size",
              ...(mark === sunburst && { levels: 3 }),
              tooltip: {
                content: ["flare/", { path: true, separator: "/" }],
                heading: [{ path: true }],
              },
            }),
          ],
        });
        const items = written(model);
        // Every depth, from the top of the whole tree; a first-level node its own name.
        expect(items.get("vis")?.content).toBe("flare/vis");
        expect(items.get("vis / data")?.content).toBe("flare/vis/data");
        expect(items.get("vis / data / Tuple")?.content).toBe("flare/vis/data/Tuple");
        expect(items.get("util / math")?.content).toBe("flare/util/math");
        // The default separator joins them as the default tooltip names the node.
        for (const [label, item] of items) expect(item.heading).toBe(label);
      }
    },
    "writes a tree node's levels from the top of the whole tree",
  );

  it("writes the levels a drilled view stands for, its middle's and its nodes'", () => {
    const model = build({
      interaction: { zoom: true },
      marks: [
        sunburst(classes(), {
          path: LEVELS,
          value: "size",
          tooltip: { content: [{ path: true, separator: "/" }] },
        }),
      ],
    });
    model.items!.setDrillRoot(["vis", "data"]);
    model.scene(estimateText);
    const items = written(model);
    // The middle stands for vis / data; its ring's nodes keep the whole path.
    expect(items.get("vis / data")?.content).toBe("vis/data");
    expect(items.get("vis / data / Data")?.content).toBe("vis/data/Data");
    expect(items.get("vis / data")?.names).toEqual(["vis", "data"]);
    // Drilled to a first-level node, its middle writes its own name.
    model.items!.setDrillRoot(["util"]);
    model.scene(estimateText);
    expect(written(model).get("util")?.content).toBe("util");
  });

  it("writes the whole tree's middle as nothing, and keeps separators as given", () => {
    const write = tooltipWriters("en-US", "UTC", GUIDE_KIT);
    const mark = sunburst(classes(), {
      path: LEVELS,
      value: "size",
      tooltip: { content: ["[", { path: true, separator: "" }, "]"] },
    });
    const at = (names: readonly string[]) =>
      texts(write(mark, undefined, { label: "", value: 0, text: "" }, names)?.content);
    expect(at([])).toBe("[]");
    expect(at(["vis", "data"])).toBe("[visdata]");
    const arrows = sunburst(classes(), {
      path: LEVELS,
      value: "size",
      tooltip: { content: [{ path: true, separator: " → ", style: { fontWeight: 600 } }] },
    });
    expect(
      write(arrows, undefined, { label: "", value: 0, text: "" }, ["a", "b"])?.content,
    ).toEqual([{ text: "a → b", style: { fontWeight: 600 } }]);
  });

  it("writes each level as its field's display does", () => {
    const fields: FieldDisplays = {
      level1: { mappings: [{ value: "vis", text: "Visualization" }] },
      level2: { mappings: [{ value: "data", text: "Data sets" }] },
    };
    for (const mark of [sunburst, treemap]) {
      const model = build({
        fields,
        marks: [
          mark(classes(), {
            path: LEVELS,
            value: "size",
            ...(mark === sunburst && { levels: 3 }),
            tooltip: { content: [{ path: true, separator: "/" }], heading: [{ path: true }] },
          }),
        ],
      });
      const items = [...written(model).values()];
      const tuple = items.find((item) => item.names?.at(-1) === "Tuple")!;
      expect(tuple.content).toBe("Visualization/Data sets/Tuple");
      // As the default tooltip writes it.
      expect(items.map((item) => item.heading)).toEqual([...written(model).keys()]);
    }
    // A tree of nodes and parents writes every level by its node field's display.
    const nodes = table({
      id: ["root", "a", "b", "c"],
      parent: [null, "root", "root", "a"],
      units: [0, 3, 4, 2],
    });
    const model = build({
      fields: { id: { mappings: [{ value: "a", text: "Alpha" }] } },
      marks: [
        treemap(nodes, {
          node: "id",
          parent: "parent",
          value: "units",
          tooltip: { content: [{ path: true, separator: "/" }], heading: [{ path: true }] },
        }),
      ],
    });
    const items = written(model);
    const c = [...items.values()].find((item) => item.names?.at(-1) === "c")!;
    expect(c.content).toBe(
      `${c
        .names!.slice(0, -2)
        .map((n) => `${n}/`)
        .join("")}Alpha/c`,
    );
    expect([...items.values()].map((item) => item.heading)).toEqual([...items.keys()]);
  });
});

describe("tooltip paths in specs", () => {
  const spec = (mark: object): ChartSpec =>
    ({
      data: { d: { columns: { a: ["x", "x", "y"], b: ["p", "q", "r"], v: [1, 2, 3] } } },
      marks: [{ data: "d", ...mark }],
    }) as unknown as ChartSpec;
  const refusal = (mark: object) => {
    try {
      loadSpec(spec(mark));
    } catch (error) {
      return (error as Error).message;
    }
    return undefined;
  };
  const tree = { type: "sunburst", path: ["a", "b"], value: "v" };

  it("write as the types do", () => {
    const { config } = loadSpec(
      spec({ ...tree, tooltip: { content: [{ path: true, separator: "/" }] } }),
    );
    const items = written(build(config));
    expect(items.get("x / q")?.content).toBe("x/q");
  });

  it("are refused on other marks, and with a separator that is not text", () => {
    expect(refusal({ type: "line", x: "a", y: "v", tooltip: { content: [{ path: true }] } })).toBe(
      "marks[0].tooltip.content[0].path: only treemaps' and sunbursts' nodes have levels; give { series: true } or { field }",
    );
    expect(
      refusal({ type: "pie", category: "a", value: "v", tooltip: { heading: [{ path: true }] } }),
    ).toBe(
      "marks[0].tooltip.heading[0].path: only treemaps' and sunbursts' nodes have levels; give { series: true } or { field }",
    );
    expect(refusal({ ...tree, tooltip: { content: [{ path: true, separator: 1 }] } })).toBe(
      "marks[0].tooltip.content[0].separator: expected a string; received 1",
    );
    expect(refusal({ ...tree, tooltip: { content: [{ path: 1 }] } })).toBe(
      "marks[0].tooltip.content[0].path: expected true; received 1",
    );
    // Labels' parts are the labels' own.
    expect(
      refusal({ type: "text", x: "a", y: "v", label: { content: [{ path: true }] } }),
    ).toContain("expected text, { field }, { series: true }, { value: true }, or { label }");
  });
});
