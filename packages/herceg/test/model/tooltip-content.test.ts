// Tooltip content: a mark's tooltip row made of label parts, written into
// inspections when the chart inspects (and so tooltips, hover events, and
// announcements).
import { describe, expect, it } from "vitest";
import { time } from "../../src/data/column.ts";
import { table } from "../../src/data/table.ts";
import { describeInspection } from "../../src/dom/tooltip.ts";
import type { FieldDisplays } from "../../src/fields/rules.ts";
import { estimateText } from "../../src/layout/text.ts";
import { area } from "../../src/marks/area.ts";
import { gauge } from "../../src/marks/gauge.ts";
import { heatmap } from "../../src/marks/heatmap.ts";
import { line } from "../../src/marks/line.ts";
import { pie } from "../../src/marks/pie.ts";
import { point3d } from "../../src/marks/point3d.ts";
import { rug } from "../../src/marks/rug.ts";
import { sunburst } from "../../src/marks/sunburst.ts";
import { tooltipWriters } from "../../src/marks/tooltip-writers.ts";
import { treemap } from "../../src/marks/treemap.ts";
import { GUIDE_KIT } from "../../src/model/guides.ts";
import { type ChartConfig, ChartModel } from "../../src/model/model.ts";
import { staticCompilers } from "../../src/render/compilers.ts";
import type { ChartError } from "../../src/spec/errors.ts";
import { loadSpec } from "../../src/spec/load.ts";
import type { ChartSpec } from "../../src/spec/spec.ts";
import { validateSpec } from "../../src/spec/validate.ts";
import { contractTest } from "../helpers/contracts.ts";
import { xScale } from "../helpers/scales.ts";

function build(config: ChartConfig) {
  const model = new ChartModel(
    { locale: "en-US", timeZone: "UTC", ...config },
    undefined,
    staticCompilers(),
  );
  // As a chart does once it has loaded what writes tooltips.
  model.writers = tooltipWriters;
  model.setSize(600, 300, 1);
  model.scene(estimateText);
  return model;
}

const SECOND = 1_000;
const start = Date.UTC(2026, 9, 1, 11, 42, 7, 318);
/** A7's observations: each series at its own times, in one table. */
const observations = () =>
  table({
    time: time([start, start + 40, start + SECOND, start + SECOND + 40]),
    series: ["pump-a", "flow", "pump-a", "flow"],
    value: [245.31, 12.04, 246.92, 11.5],
    note: ["ok", null, "late", "ok"],
  });
const row = [
  { series: true },
  " ",
  { value: true, format: { number: ".1f" } },
  " ",
  { field: "time", format: { time: "%H:%M:%S.%L" } },
] as const;

/** The text and runs each point of the inspection at time `t` carries. */
function contentAt(model: ChartModel, t: number) {
  const inspection = model.inspect(xScale(model)!.map(t), 150)!;
  return inspection.points.map((p) => p.content);
}
const texts = (runs: readonly { text: string }[] | undefined) => runs?.map((r) => r.text).join("");

describe("tooltip content", () => {
  contractTest(
    "inspection.content",
    () => {
      const model = build({
        inspection: { mode: "nearest-x", snap: "each" },
        marks: [
          line(observations(), {
            x: "time",
            y: "value",
            series: "series",
            tooltip: { content: row },
          }),
        ],
      });
      const inspection = model.inspect(xScale(model)!.map(start), 150)!;
      expect(inspection.points.map((p) => texts(p.content))).toEqual([
        "pump-a 245.3 11:42:07.318",
        "flow 12.0 11:42:07.358",
      ]);
      // Runs, one per part, in their order; the name and value stay as they are.
      expect(inspection.points[0]!.content).toEqual([
        { text: "pump-a" },
        { text: " " },
        { text: "245.3" },
        { text: " " },
        { text: "11:42:07.318" },
      ]);
      expect([inspection.points[0]!.label, inspection.points[0]!.text]).toEqual([
        "pump-a",
        "245.31",
      ]);
      // Announcements read the row in place of the name and value.
      expect(describeInspection(inspection)).toBe(
        `${inspection.label}. pump-a 245.3 11:42:07.318. flow 12.0 11:42:07.358`,
      );
    },
    "writes each point's row from its parts, as A7 asks",
  );

  it("writes the value as the tooltip does without a format, and fields through their displays", () => {
    const fields: FieldDisplays = {
      value: { format: { number: ".3f" } },
      note: { label: "Note", missing: "n/a" },
    };
    const model = build({
      fields,
      inspection: { mode: "nearest-x", snap: "each" },
      y: { tooltipFormat: { number: ".2f" } },
      marks: [
        line(observations(), {
          x: "time",
          y: "value",
          series: "series",
          tooltip: {
            content: [
              { value: true },
              "|",
              { value: true, format: { number: ".0f" } },
              "|",
              { field: "value" },
              "|",
              { field: "value", format: { number: ".1f" } },
              "|",
              { field: "note" },
              "|",
              { label: "note" },
              "|",
              { label: "value" },
            ],
          },
        }),
      ],
    });
    const [pumpA, flow] = contentAt(model, start).map(texts);
    // The value as the tooltip writes it (the axis' tooltip format over the
    // field's display), a part's format over both; fields through their
    // displays, a part's format over the display's, missing text as the
    // display gives it; labels as displays give them, else the name.
    expect(pumpA).toBe("245.31|245|245.310|245.3|ok|Note|value");
    expect(flow).toBe("12.04|12|12.040|12.0|n/a|Note|value");
  });

  it("styles its runs with their parts' styles", () => {
    const model = build({
      marks: [
        line(observations(), {
          x: "time",
          y: "value",
          series: "series",
          tooltip: {
            content: [
              { series: true, style: { fontWeight: 600, color: "#123456" } },
              " ",
              { value: true, style: { fontStyle: "italic", opacity: 0.6, fontSize: 11 } },
            ],
          },
        }),
      ],
    });
    expect(contentAt(model, start)[0]).toEqual([
      { text: "pump-a", style: { fontWeight: 600, color: "#123456" } },
      { text: " " },
      { text: "245.31", style: { fontStyle: "italic", opacity: 0.6, fontSize: 11 } },
    ]);
  });

  it("writes stacked layers' values as their tooltips do, and their rows' fields", () => {
    const model = build({
      marks: [
        area(observations(), {
          x: "time",
          y: "value",
          series: "series",
          stack: "fill",
          tooltip: {
            content: [{ series: true }, ": ", { value: true }, " (", { field: "note" }, ")"],
          },
        }),
      ],
      inspection: { mode: "nearest-x", snap: "each" },
    });
    const [first] = model.inspect(xScale(model)!.map(start), 150)!.points;
    // A share stack's value is written as its tooltip writes it: the share and the value.
    expect(first!.text).toContain("245.31");
    expect(texts(first!.content)).toBe(`pump-a: ${first!.text} (ok)`);
  });

  it("writes a value as its format says: a time for a time pattern or Intl date options", () => {
    const hour = 3_600_000;
    const readings = table({
      site: ["north", "south"],
      when: time([start, start + hour]),
      temp: [21.34, 19.87],
    });
    const write = tooltipWriters("en-US", "UTC", GUIDE_KIT);
    const written = (mark: object, value: number) =>
      texts(write(mark as never, 0, { label: "", value, text: String(value) })?.content);
    const asNumber = { content: [{ value: true, format: { number: ".1f" } }] } as const;
    const asTime = { content: [{ value: true, format: { time: "%H:%M" } }] } as const;
    // A heatmap's cells are read along times, their values are temperatures.
    expect(
      written(heatmap(readings, { x: "site", y: "when", color: "temp", tooltip: asNumber }), 21.34),
    ).toBe("21.3");
    // A 3D point's value is its z, here a time.
    const cloud = table({ x: [0, 1], y: [1, 2], when: time([start, start + hour]) });
    expect(written(point3d(cloud, { x: "x", y: "y", z: "when", tooltip: asTime }), start)).toBe(
      "11:42",
    );
    // A rug's value is along its own axis: its field's times.
    expect(written(rug(readings, { x: "when", tooltip: asTime }), start)).toBe("11:42");
    // On a scale of the chart's own, which tells the axes nothing.
    const dated = line(readings, {
      x: "temp",
      y: { field: "when", scale: "dates" },
      tooltip: { content: [{ value: true, format: { dateStyle: "short" } }] },
    });
    expect(written(dated, start)).toBe("10/1/26");
    // Missing, or beyond what dates hold, a value has nothing to write.
    const gaugeIn = (format: object) =>
      gauge(table({ v: [null] }), {
        value: "v",
        tooltip: { content: [{ value: true, format: format as never }] },
      });
    const times = [{ dateStyle: "short" }, { time: "%H:%M" }];
    for (const format of [...times, { number: ".1f" }])
      expect(written(gaugeIn(format), Number.NaN)).toBe("–");
    for (const format of times) expect(written(gaugeIn(format), 1e20)).toBe("–");
  });

  it("writes layout items' parts: names by their fields, and – where no one row is the item", () => {
    const sales = table({
      region: ["Europe", "Europe", "Asia"],
      country: ["France", "Spain", "Japan"],
      units: [4, 2, 5],
      note: ["a", "b", "c"],
    });
    const content = [
      { series: true },
      ": ",
      { value: true },
      " ",
      { field: "region" },
      "/",
      { field: "country" },
      " ",
      { field: "note" },
    ] as const;
    /** The item's content, its value as the tooltip writes it in place of `#`. */
    const contentOf = (model: ChartModel, label: string) => {
      const result = model.items!.result()!;
      for (let i = 0; i < result.count; i++)
        if (result.item(i).label === label) {
          const [point] = model.inspectItem(result.item(i).key)!.points;
          return texts(point!.content)!.replace(point!.text, "#");
        }
      throw new Error(`no item ${label}`);
    };
    // A slice of several rows is named by its category; its other fields have no one value.
    const slices = build({
      marks: [pie(sales, { category: "region", value: "units", tooltip: { content } })],
    });
    expect(contentOf(slices, "Europe")).toBe("Europe: # Europe/– –");
    expect(contentOf(slices, "Asia")).toBe("Asia: # Asia/Japan c");
    // A tree's node by its path: ancestors' names, its own, none below it.
    for (const mark of [treemap, sunburst]) {
      const tree = build({
        marks: [mark(sales, { path: ["region", "country"], value: "units", tooltip: { content } })],
      });
      expect(contentOf(tree, "Europe")).toBe("Europe: # Europe/– –");
      expect(contentOf(tree, "Europe / Spain")).toBe("Europe / Spain: # Europe/Spain b");
    }
    // A tree of nodes and parents: its node field names it, its parent field its parent.
    const nodes = table({
      id: ["root", "a", "b"],
      parent: [null, "root", "root"],
      units: [0, 3, 4],
    });
    const tree = build({
      marks: [
        treemap(nodes, {
          node: "id",
          parent: "parent",
          value: "units",
          tooltip: { content: [{ field: "id" }, " in ", { field: "parent" }] },
        }),
      ],
    });
    const result = tree.items!.result()!;
    const written = Array.from({ length: result.count }, (_, i) =>
      texts(tree.inspectItem(result.item(i).key)!.points[0]!.content),
    );
    expect(written).toContain("a in root");
  });

  it("are refused where a part names a field the table lacks", () => {
    expect(() =>
      line(observations(), {
        x: "time",
        y: "value",
        tooltip: { content: [{ field: "temperature" as "value" }] },
      }),
    ).toThrow(
      'line tooltip.content[0].field: no field "temperature"; the table has "time", "series", "value", "note"',
    );
    expect(() =>
      line(observations(), {
        x: "time",
        y: "value",
        tooltip: { content: [{ label: "unit" as "value" }] },
      }),
    ).toThrow('line tooltip.content[0].label: no field "unit"');
  });

  it("tells of a format on a series' name once, and writes the name as it is", () => {
    const told: string[] = [];
    const model = new ChartModel(
      {
        locale: "en-US",
        timeZone: "UTC",
        marks: [
          line(observations(), {
            x: "time",
            y: "value",
            // Only JavaScript can give one: the types refuse it.
            tooltip: {
              content: [{ series: true, format: { number: ".1f" } } as never, " ", { value: true }],
            },
          }),
        ],
      },
      undefined,
      staticCompilers(),
    );
    model.writers = tooltipWriters;
    model.report = (error) => told.push(error.message);
    model.setSize(600, 300, 1);
    for (let frame = 0; frame < 3; frame++) {
      model.scene(estimateText);
      expect(contentAt(model, start).map(texts)).toEqual(["value 245.31"]);
    }
    expect(told).toEqual([
      "line tooltip.content[0]: a series' name is written as it is; drop format",
    ]);
  });

  it("come from specs, which are checked", () => {
    const spec = (tooltip: unknown, type = "line", extra: object = {}): ChartSpec =>
      ({
        data: {
          d: {
            columns: {
              t: { type: "time", values: ["2026-01-19", "2026-01-20"] },
              v: [1, 2],
              k: ["a", "b"],
            },
          },
        },
        marks: [{ type, x: "t", y: "v", tooltip, ...extra }],
      }) as ChartSpec;
    const { config } = loadSpec(spec({ content: [{ field: "k" }, " ", { value: true }] }));
    const model = build(config);
    expect(contentAt(model, Date.UTC(2026, 0, 20)).map(texts)).toEqual(["b 2"]);
    expect(() => validateSpec(spec({ content: [] }))).toThrow(
      /marks\[0\]\.tooltip\.content: expected a list of parts/,
    );
    expect(() =>
      validateSpec(spec({ content: [{ series: true, format: { number: ".1f" } }] })),
    ).toThrow(
      /marks\[0\]\.tooltip\.content\[0\]\.format: expected no format: a series' name is written as it is/,
    );
    expect(() => loadSpec(spec({ content: [{ field: "m" }] }))).toThrow(
      /tooltip.content\[0\].field: no field "m"/,
    );
    // A format the field's kind does not take is refused as the spec loads.
    expect(() => loadSpec(spec({ content: [{ field: "k", format: { number: ".1f" } }] }))).toThrow(
      /tooltip.content\[0\].format/,
    );
    // Marks summarizing rows write their summaries as they are.
    const refusal = (mark: object) => {
      try {
        validateSpec({
          data: { d: { columns: { x: [1, 2, 3], y: [4, 5, 6] } } },
          marks: [{ ...mark, tooltip: { content: ["n"] } }],
        } as unknown as ChartSpec);
      } catch (error) {
        const { code, path, message } = error as ChartError;
        return { code, path, message };
      }
      return undefined;
    };
    expect(refusal({ type: "contour", x: "x", y: "y", color: "y" })).toEqual({
      code: "unsupported",
      path: "marks[0].tooltip.content",
      message:
        "marks[0].tooltip.content: a contour's bands summarize its grid, and its tooltips write each summary as it is; drop content",
    });
    expect(refusal({ type: "histogram", x: "x" })?.message).toContain(
      "a histogram's bins count rows",
    );
  });

  it("is written only once the chart has what writes it, which it loads before drawing", () => {
    const marks = [line(observations(), { x: "time", y: "value", tooltip: { content: row } })];
    const model = new ChartModel({ marks, timeZone: "UTC" });
    expect(model.lacks()).toEqual([false, false, false, true]);
    model.setSize(600, 300, 1);
    model.scene(estimateText);
    expect(contentAt(model, start)).toEqual([undefined]);
    model.use([undefined, undefined, undefined, tooltipWriters]);
    expect(model.lacks()).toEqual([false, false, false, false]);
    model.scene(estimateText);
    expect(contentAt(model, start).map(texts)).toEqual(["value 245.3 11:42:07.318"]);
    // Fields ask for it too; marks without either do not.
    const fields = new ChartModel({
      marks: [line(observations(), { x: "time", y: "value", tooltip: { fields: ["note"] } })],
    });
    expect(fields.lacks()[3]).toBe(true);
    expect(
      new ChartModel({ marks: [line(observations(), { x: "time", y: "value" })] }).lacks()[3],
    ).toBe(false);
  });
});
