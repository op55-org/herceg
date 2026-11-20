// Tooltip headings: a mark's `tooltip.heading`, written from each inspected
// point's row by the writers that write `content` and carried by the point
// (`point.heading`), and the heading a tooltip shows (`headingOf`): none
// with the chart's `heading: false`, else a point shown alone's own, else
// the place. Announcements keep the place.
import { describe, expect, it } from "vitest";
import { time } from "../../src/data/column.ts";
import { table } from "../../src/data/table.ts";
import { describeInspection, headingOf } from "../../src/dom/tooltip.ts";
import { estimateText } from "../../src/layout/text.ts";
import { custom } from "../../src/marks/custom.ts";
import { line } from "../../src/marks/line.ts";
import { pie } from "../../src/marks/pie.ts";
import { point } from "../../src/marks/point.ts";
import { tooltipWriters } from "../../src/marks/tooltip-writers.ts";
import { type ChartConfig, ChartModel, type Inspection } from "../../src/model/model.ts";
import { staticCompilers } from "../../src/render/compilers.ts";
import { NO_PAGE } from "../../src/render/fallbacks.ts";
import { renderSvg } from "../../src/render/svg.ts";
import { titlesOf } from "../../src/render/titles.ts";
import type { ChartError } from "../../src/spec/errors.ts";
import { loadSpec } from "../../src/spec/load.ts";
import type { ChartSpec } from "../../src/spec/spec.ts";
import { validateSpec } from "../../src/spec/validate.ts";
import { inspectionPayload } from "../../src/web/events.ts";
import { contractTest } from "../helpers/contracts.ts";
import { xScale, yScale } from "../helpers/scales.ts";

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

const start = Date.UTC(2026, 9, 1, 11, 42, 7, 318);
/** Two series of observations, each at its own times. */
const observations = () =>
  table({
    time: time([start, start + 40, start + 1_000, start + 1_040]),
    series: ["pump-a", "flow", "pump-a", "flow"],
    value: [245.31, 12.04, 246.92, 11.5],
    site: ["north", "south", "north", "south"],
  });

/** A2's forecasts: range items with an id. */
const forecasts = () =>
  table({
    id: ["C-12", "C-13"],
    start: [10, 30],
    end: [25, 45],
    confidence: [0.8, 0.6],
    category: ["rates", "fx"],
  });

const texts = (runs: readonly { text: string }[] | undefined) =>
  runs?.map((run) => run.text).join("");

/** An inspection of `points`, each as a tooltip reads it (only what `headingOf` reads matters). */
const inspection = (...headings: (string | undefined)[]): Inspection => ({
  axis: "x",
  value: 0,
  position: 0,
  label: "11:42",
  points: headings.map((heading, i) => ({
    mark: 0,
    markId: undefined,
    key: String(i),
    label: `s${i}`,
    row: i,
    color: "#000",
    text: "1",
    value: 1,
    px: 0,
    py: 0,
    ...(heading !== undefined && { heading: [{ text: heading }] }),
  })),
});

describe("tooltip headings", () => {
  contractTest(
    "inspection.heading",
    () => {
      for (const tooltip of [true, { heading: false as const }]) {
        const model = build({
          tooltip,
          inspection: { mode: "nearest-x", snap: "each" },
          marks: [
            line(observations(), {
              x: "time",
              y: "value",
              series: "series",
              tooltip: {
                heading: [{ field: "site", style: { fontWeight: 600 } }, " ", { series: true }],
              },
            }),
          ],
        });
        const read = model.inspect(xScale(model)!.map(start), 150)!;
        // Every point carries its own, whatever the chart's tooltip shows.
        expect(read.points.map((p) => texts(p.heading))).toEqual(["north pump-a", "south flow"]);
        expect(read.points[0]!.heading).toEqual([
          { text: "north", style: { fontWeight: 600 } },
          { text: " " },
          { text: "pump-a" },
        ]);
        // The place stays the inspection's label, which the keyboard announces.
        expect(read.label).toBe("Oct 1, 2026, 11:42:07.318");
        expect(describeInspection(read)).toBe(
          "Oct 1, 2026, 11:42:07.318. pump-a: 245.31. flow: 12.04",
        );
      }
    },
    "carries each point's heading, written from its row as content is; the label stays the place",
  );

  contractTest(
    "tooltip.heading.rule",
    () => {
      const text = (heading: readonly { text: string }[] | undefined) => texts(heading);
      // The chart's false: no heading, whatever the points carry.
      expect(headingOf(inspection("C-12"), false)).toBeUndefined();
      expect(headingOf(inspection(undefined, undefined), false)).toBeUndefined();
      // A point shown alone: its own heading where its mark has one, else the place.
      expect(text(headingOf(inspection("C-12"), true))).toBe("C-12");
      expect(text(headingOf(inspection(undefined), true))).toBe("11:42");
      // Several points keep the place, headed or not: the legend hiding one
      // would otherwise retitle the rows.
      expect(text(headingOf(inspection("C-12", "C-13"), true))).toBe("11:42");
      expect(text(headingOf(inspection(undefined, "C-13"), true))).toBe("11:42");
      // A pinned reading with no points left.
      expect(text(headingOf(inspection(), true))).toBe("11:42");
      // The keyboard says the place, and a point's heading where it reads it alone.
      expect(describeInspection(inspection("C-12"))).toBe("11:42. C-12. s0: 1");
      expect(describeInspection(inspection(undefined))).toBe("11:42. s0: 1");
      expect(describeInspection(inspection("C-12", "C-13"))).toBe("11:42. s0: 1. s1: 1");
      // A heading of no text says nothing of it.
      expect(describeInspection(inspection(""))).toBe("11:42. s0: 1");
    },
    "decides a tooltip's heading: the chart's false, else a point shown alone's own, else the place",
  );

  it("writes parts' fields and values in their formats, and the series' name", () => {
    const model = build({
      fields: { value: { format: { number: ".3f" } }, site: { label: "Site" } },
      inspection: { mode: "nearest" },
      marks: [
        point(observations(), {
          x: "time",
          y: "value",
          series: "series",
          tooltip: {
            heading: [
              { field: "time", format: { time: "%H:%M:%S" } },
              "|",
              { value: true, format: { number: ".1f" } },
              "|",
              { value: true },
              "|",
              { field: "value" },
              "|",
              { label: "site" },
              "|",
              { series: true },
            ],
          },
        }),
      ],
    });
    const x = xScale(model)!.map(start);
    const y = yScale(model)!.map(245.31);
    const [read] = model.inspect(x, y)!.points;
    // The value as the tooltip writes it (through the field's display), a
    // part's format over it; a field as its display writes it; its label.
    expect(texts(read!.heading)).toBe("11:42:07|245.3|245.310|245.310|Site|pump-a");
  });

  it("writes a layout item's names by their fields, and – where no one row is the item", () => {
    const sales = table({
      region: ["Europe", "Europe", "Asia"],
      units: [4, 2, 5],
      note: ["a", "b", "c"],
    });
    const model = build({
      marks: [
        pie(sales, {
          category: "region",
          value: "units",
          tooltip: { heading: [{ field: "region" }, " (", { field: "note" }, ")"] },
        }),
      ],
    });
    const result = model.items!.result()!;
    const headings = Array.from({ length: result.count }, (_, i) =>
      texts(model.inspectItem(result.item(i).key)!.points[0]!.heading),
    );
    expect(headings.sort()).toEqual(["Asia (c)", "Europe (–)"]);
  });

  it("are refused where a part names a field the table lacks", () => {
    expect(() =>
      custom(forecasts(), {
        itemKey: "id",
        x: ["start", "end"],
        y: "id",
        tooltip: { heading: [{ field: "name" as "id" }] },
        draw: () => {},
      }),
    ).toThrow(
      'custom tooltip.heading[0].field: no field "name"; the table has "id", "start", "end", "confidence", "category"',
    );
    expect(() =>
      line(observations(), {
        x: "time",
        y: "value",
        tooltip: { heading: [{ label: "unit" as "value" }] },
      }),
    ).toThrow('line tooltip.heading[0].label: no field "unit"');
  });

  it("tells of a format on a series' name by the heading's part", () => {
    const told: string[] = [];
    const model = new ChartModel(
      {
        locale: "en-US",
        timeZone: "UTC",
        inspection: { mode: "nearest" },
        marks: [
          point(observations(), {
            x: "time",
            y: "value",
            // Only JavaScript can give one: the types refuse it.
            tooltip: { heading: [{ series: true, format: { number: ".1f" } } as never] },
          }),
        ],
      },
      undefined,
      staticCompilers(),
    );
    model.writers = tooltipWriters;
    model.report = (error) => told.push(error.message);
    model.setSize(600, 300, 1);
    model.scene(estimateText);
    model.inspect(xScale(model)!.map(start), yScale(model)!.map(245.31));
    expect(told).toEqual([
      "point tooltip.heading[0]: a series' name is written as it is; drop format",
    ]);
  });

  it("come from specs, which refuse a heading's parts on the chart and false on a mark", () => {
    const spec = (chart: object, tooltip?: unknown, type = "line"): ChartSpec =>
      ({
        data: { d: { columns: { t: [1, 2], v: [1, 2], k: ["a", "b"] } } },
        marks: [{ type, x: "t", y: "v", ...(tooltip !== undefined && { tooltip }) }],
        ...chart,
      }) as ChartSpec;
    const refusal = (given: ChartSpec) => {
      try {
        loadSpec(given);
      } catch (error) {
        const { code, path, message } = error as ChartError;
        return { code, path, message };
      }
      return undefined;
    };
    const { config } = loadSpec(
      spec({ tooltip: { heading: false } }, { heading: [{ field: "k" }, ": ", { value: true }] }),
    );
    expect(config.tooltip).toEqual({ heading: false });
    const model = build({ ...config, inspection: { mode: "nearest" } });
    const [read] = model.inspect(xScale(model)!.map(2), yScale(model)!.map(2))!.points;
    expect(texts(read!.heading)).toBe("b: 2");
    expect(refusal(spec({ tooltip: { heading: [{ field: "k" }] } }))).toEqual({
      code: "invalid-option",
      path: "tooltip.heading",
      message:
        "tooltip.heading: the chart's tooltip takes false (no heading); give parts to a mark's tooltip",
    });
    expect(refusal(spec({ tooltip: { heading: true } }))?.path).toBe("tooltip.heading");
    expect(refusal(spec({}, { heading: false }))).toEqual({
      code: "invalid-option",
      path: "marks[0].tooltip.heading",
      message:
        "marks[0].tooltip.heading: no heading is the chart's choice; give heading: false to the chart's tooltip",
    });
    expect(() => validateSpec(spec({}, { heading: [] }))).toThrow(
      /marks\[0\]\.tooltip\.heading: expected a list of parts/,
    );
    expect(refusal(spec({}, { heading: [{ field: "m" }] }))?.message).toMatch(
      /tooltip.heading\[0\].field: no field "m"/,
    );
    // A format the field's kind does not take is refused as the spec loads.
    expect(refusal(spec({}, { heading: [{ field: "k", format: { number: ".1f" } }] }))?.path).toBe(
      "marks[0].tooltip.heading[0].format",
    );
    // Marks summarizing rows write their summaries as they are.
    expect(
      refusal({
        data: { d: { columns: { x: [1, 2, 3] } } },
        marks: [{ type: "histogram", x: "x", tooltip: { heading: ["n"] } }],
      } as unknown as ChartSpec),
    ).toMatchObject({
      code: "unsupported",
      path: "marks[0].tooltip.heading",
      message: expect.stringMatching(
        /^marks\[0\]\.tooltip\.heading: a histogram's bins count rows.*; drop heading$/,
      ),
    });
  });

  it("is serialised by web events as content is", () => {
    const model = build({
      inspection: { mode: "nearest" },
      marks: [
        point(observations(), {
          x: "time",
          y: "value",
          series: "series",
          tooltip: { heading: [{ field: "site", style: { color: "#c00" } }] },
        }),
      ],
    });
    const read = model.inspect(xScale(model)!.map(start), yScale(model)!.map(245.31));
    const chart = { getPanels: () => model.panels() } as never;
    const payload = inspectionPayload(chart, read, model.panels() as never)!;
    expect(payload.points[0]!.heading).toEqual([{ text: "north", style: { color: "#c00" } }]);
    // A copy: the payload shares nothing with the inspection.
    expect(payload.points[0]!.heading![0]!.style).not.toBe(read!.points[0]!.heading![0]!.style);
  });

  contractTest(
    "svg.titles.heading",
    () => {
      const titlesOfChart = (config: Omit<ChartConfig, "locale">) => {
        const model = new ChartModel(
          { locale: "en-US", timeZone: "UTC", legend: false, ...config },
          NO_PAGE,
          staticCompilers(),
        );
        model.setSize(400, 300, 1);
        const { scene, titles } = titlesOf(model, estimateText);
        const svg = renderSvg(scene, { idPrefix: "t", titles });
        return [...svg.matchAll(/<title>([^<]*)<\/title>/g)].map(([, text]) =>
          text!.replaceAll("&#10;", "\n"),
        );
      };
      const rows = table({ x: [1, 2], y: [10, 20], id: ["C-12", "C-13"] });
      const headed = point(rows, { x: "x", y: "y", tooltip: { heading: [{ field: "id" }] } });
      // A title reads one point: headed by its mark's heading, else the place.
      expect(titlesOfChart({ marks: [headed] })).toEqual(["C-12\ny: 10", "C-13\ny: 20"]);
      expect(titlesOfChart({ marks: [point(rows, { x: "x", y: "y" })] })).toEqual([
        "1\ny: 10",
        "2\ny: 20",
      ]);
      // The chart's false: none.
      expect(titlesOfChart({ tooltip: { heading: false }, marks: [headed] })).toEqual([
        "y: 10",
        "y: 20",
      ]);
    },
    "heads static SVG titles as tooltips are headed",
  );
});
