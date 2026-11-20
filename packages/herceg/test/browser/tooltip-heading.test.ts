// Tooltip headings: the chart's `tooltip: { heading: false }` leaves every
// tooltip's heading row out (shared readings, items, pinned and keyboard
// tooltips), and a mark's `tooltip.heading` heads a tooltip that shows one
// of its points alone, in place of the place it reads. Announcements keep
// the place.
import "./interactive.ts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { encodedCategory, time } from "../../src/data/column.ts";
import { orderedTable } from "../../src/data/ordered.ts";
import { type Table, table } from "../../src/data/table.ts";
import { type Chart, type ChartOptions, createChart } from "../../src/dom/chart.ts";
import { Tooltip } from "../../src/dom/tooltip.ts";
import { custom } from "../../src/marks/custom.ts";
import { line } from "../../src/marks/line.ts";
import { pie } from "../../src/marks/pie.ts";
import type { MarkTooltip } from "../../src/marks/tooltip-fields.ts";
import { facet } from "../../src/model/facet.ts";
import { LIGHT } from "../../src/theme.ts";
import { contractTest } from "../helpers/contracts.ts";
import { modelOf } from "./helpers.ts";

let host: HTMLDivElement;
const charts: Chart[] = [];

beforeEach(() => {
  host = document.createElement("div");
  host.style.cssText = "width:600px;height:300px";
  document.body.append(host);
});

afterEach(() => {
  for (const chart of charts.splice(0)) chart.destroy();
  host.remove();
});

async function mount(options: ChartOptions): Promise<Chart> {
  const chart = createChart(host, { locale: "en-US", timeZone: "UTC", ...options });
  charts.push(chart);
  for (let loading = chart.loading; loading; loading = chart.loading) await loading;
  return chart;
}

/** Moves the pointer to pixel (`px`, `py`) of the chart and draws. */
function point(chart: Chart, px: number, py: number) {
  const rect = chart.root.getBoundingClientRect();
  chart.root.dispatchEvent(
    new PointerEvent("pointermove", {
      bubbles: true,
      clientX: rect.left + px,
      clientY: rect.top + py,
    }),
  );
  chart.render();
}

/** Points at value (`x`, `y`) of the chart's axes. */
const at = (chart: Chart, x: number, y: number) =>
  point(chart, chart.toPixel(x, { axis: "x" })!, chart.toPixel(y, { axis: "y" })!);

/** Where a layout mark's item labelled `label` is read, in pixels of the chart. */
function itemAt(chart: Chart, label: string): [number, number] {
  const model = modelOf(chart);
  let key = model.stepItem(undefined, 1);
  const seen = new Set<string>();
  while (key !== undefined && !seen.has(key)) {
    seen.add(key);
    const [found] = model.inspectItem(key)!.points;
    if (found!.label === label) return [found!.px, found!.py];
    key = model.stepItem(key, 1);
  }
  throw new Error(`No item ${label}`);
}

/** The tooltip boxes shown, the chart's own first (pinned ones take the focus, not aria-hidden). */
const boxes = (chart: Chart) =>
  [...chart.root.children].filter(
    (child): child is HTMLDivElement =>
      child instanceof HTMLDivElement &&
      child.style.padding === "8px 10px" &&
      child.style.display === "block",
  );
const box = (chart: Chart) => boxes(chart)[0];
/** The box's rows as text, its heading first where it has one. */
const rows = (chart: Chart) => [...(box(chart)?.children ?? [])].map((row) => row.textContent);
const key = (chart: Chart, name: string) =>
  chart.root.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true }));
const said = (chart: Chart) => chart.root.querySelector("[aria-live]")!.textContent;
const texts = (runs: readonly { text: string }[] | undefined) =>
  runs?.map((run) => run.text).join("");

/** A2's comets: forecasts from start to end, on lanes, by category. */
const forecasts = () =>
  table({
    id: ["C-12", "C-13", "C-14"],
    start: [10, 30, 50],
    end: [25, 45, 70],
    lane: [1, 2, 3],
    category: ["rates", "fx", "rates"],
  });

type CometTooltip = MarkTooltip<ReturnType<typeof forecasts> extends Table<infer S> ? S : never>;

function comets(tooltip: CometTooltip) {
  return custom(forecasts(), {
    id: "comets",
    x: ["start", "end"],
    y: "lane",
    series: "category",
    itemKey: "id",
    tooltip,
    draw({ table: t, series, x, y, item, rect, circle }) {
      const end = t.numbers("end");
      for (const s of series)
        for (let k = 0; k < s.length; k++) {
          const row = s.rowAt(k);
          const [x0, cy] = [x(s.x[row]!), y(s.y[row]!)];
          item(s, row, () => {
            rect(x0, cy - 3, x(end[row]!) - x0, 6, { fill: s.color });
            circle(x0, cy, 4, { fill: s.color });
          });
        }
    },
  });
}

const CONTENT = [{ series: true }, ": ", { field: "start" }, " – ", { field: "end" }] as const;

const SERIES = ["pump-a", "pump-b", "flow"] as const;
const start = Date.UTC(2026, 9, 1, 11, 42, 7, 318);
/** A7's observations: every series in one ordered table, each at its own times. */
function observations() {
  const times: number[] = [];
  const codes: number[] = [];
  const values: number[] = [];
  for (let i = 0; i < 20; i++)
    for (const [s] of SERIES.entries()) {
      times.push(start + i * 1_000 + s * 40);
      codes.push(s);
      values.push(100 * (s + 1) + i + 0.31);
    }
  return orderedTable(
    {
      time: time(Float64Array.from(times)),
      series: encodedCategory(Int32Array.from(codes), SERIES),
      value: Float64Array.from(values),
    },
    { orderBy: "time" },
  );
}
const ROW = [
  { series: true },
  " ",
  { value: true, format: { number: ".1f" } },
  " ",
  { field: "time", format: { time: "%H:%M:%S.%L" } },
] as const;

describe("tooltip headings", () => {
  contractTest(
    "tooltip.heading.mark.engine",
    async () => {
      const chart = await mount({
        inspection: { mode: "nearest" },
        x: { domain: [0, 80] },
        y: { domain: [0, 4] },
        marks: [
          comets({
            heading: [
              { field: "id", style: { fontWeight: 600 } },
              " (",
              { field: "category" },
              ")",
            ],
            content: CONTENT,
          }),
        ],
      });
      at(chart, 30, 2);
      // The comet read alone is headed by its own id, its row below.
      expect(rows(chart)).toEqual(["C-13 (fx)", "fx: 30 – 45"]);
      const heading = box(chart)!.children[0] as HTMLElement;
      const runs = [...heading.children] as HTMLElement[];
      expect(runs.map((run) => run.textContent)).toEqual(["C-13", " (", "fx", ")"]);
      expect(runs[0]!.style.fontWeight).toBe("600");
      // The place stays what the keyboard announces and the inspection's label.
      const inspection = chart.inspect(
        chart.toPixel(30, { axis: "x" })!,
        chart.toPixel(2, { axis: "y" })!,
      )!;
      expect(texts(inspection.points[0]!.heading)).toBe("C-13 (fx)");
      expect(inspection.label).not.toContain("C-13");
    },
    "heads a tooltip of one comet (inspection nearest) by its own id, as A2's references do",
  );

  contractTest(
    "tooltip.heading.none.engine",
    async () => {
      // A7: the rows as their content writes them, no time heading.
      const chart = await mount({
        tooltip: { heading: false },
        inspection: { mode: "nearest-x", snap: "each", within: { milliseconds: 30_000 } },
        marks: [
          line(observations(), {
            x: "time",
            y: "value",
            series: "series",
            tooltip: { content: ROW },
          }),
        ],
      });
      const { plot } = chart.getPanels()[0]!;
      point(chart, chart.toPixel(start + 5_000, { axis: "x" })!, plot.y + plot.height / 2);
      expect(rows(chart)).toEqual([
        "pump-a 105.3 11:42:12.318",
        "pump-b 205.3 11:42:12.358",
        "flow 305.3 11:42:12.398",
      ]);
      // The rows follow at once: the box's first child is a point's row.
      expect(box(chart)!.children[0]!.children).toHaveLength(2);
      // The keyboard's tooltip has none either; its announcement keeps the place.
      chart.root.focus();
      key(chart, "ArrowRight");
      chart.render();
      expect(rows(chart)[0]).toBe("pump-a 100.3 11:42:07.318");
      expect(said(chart)).toMatch(/^pump-a 100\.3 11:42:07\.318 at Oct 1, 2026/);
      // Items, and a mark's heading: the chart's false wins.
      const sales = table({ region: ["Europe", "Asia"], units: [4, 5] });
      chart.update({
        tooltip: { heading: false },
        inspection: { mode: "nearest" },
        marks: [
          pie(sales, {
            id: "sales",
            category: "region",
            value: "units",
            tooltip: { heading: [{ field: "region" }] },
          }),
        ],
      });
      for (let loading = chart.loading; loading; loading = chart.loading) await loading;
      chart.render();
      point(chart, ...itemAt(chart, "Europe"));
      expect(rows(chart)).toHaveLength(1);
      expect(rows(chart)[0]).toContain("Europe");
    },
    "leaves every tooltip's heading out with the chart's heading: false, as A7 asks: shared, keyboard, and items",
  );

  contractTest(
    "tooltip.heading.shared.engine",
    async () => {
      const heading = [
        { series: true },
        " at ",
        { field: "time", format: { time: "%H:%M:%S.%L" } },
      ] as const;
      const chart = await mount({
        inspection: { mode: "nearest-x", snap: "each", within: { milliseconds: 30_000 } },
        marks: [
          line(observations(), {
            x: "time",
            y: "value",
            series: "series",
            tooltip: { heading, content: ROW },
          }),
        ],
      });
      const { plot } = chart.getPanels()[0]!;
      const x = chart.toPixel(start + 5_000, { axis: "x" })!;
      point(chart, x, plot.y + plot.height / 2);
      // Several points keep the place.
      const [place, ...lines] = rows(chart);
      expect(place).toMatch(/^Oct 1, 2026/);
      expect(lines).toHaveLength(3);
      // One series read alone is headed by its own heading: the legend hides the others.
      const others = chart.getLegend().filter((entry) => entry.label !== "pump-a");
      chart.setVisibility(
        others.map((entry) => entry.key),
        false,
      );
      chart.render();
      point(chart, x, plot.y + plot.height / 2);
      expect(rows(chart)).toEqual(["pump-a at 11:42:12.318", "pump-a 105.3 11:42:12.318"]);
    },
    "keeps the place over several points, and heads one series read alone by its own heading",
  );

  contractTest(
    "tooltip.heading.pinned.engine",
    async () => {
      const options: ChartOptions = {
        inspection: { mode: "nearest" },
        tooltip: { pin: "click" },
        x: { domain: [0, 80] },
        y: { domain: [0, 4] },
        marks: [comets({ heading: [{ field: "id" }, " forecast"], content: CONTENT })],
      };
      const chart = await mount(options);
      chart.pin({ item: { mark: "comets", item: ["C-13"] } });
      chart.render();
      expect(rows(chart)).toEqual(["C-13 forecast", "fx: 30 – 45"]);
      // The chart's false: the pinned tooltip has no heading either.
      chart.update({ ...options, tooltip: { pin: "click", heading: false } });
      chart.render();
      expect(rows(chart)).toEqual(["fx: 30 – 45"]);
    },
    "heads a pinned item's tooltip by its own heading, and none with the chart's false",
  );

  contractTest(
    "tooltip.heading.keyboard.engine",
    async () => {
      const chart = await mount({
        inspection: { mode: "nearest" },
        x: { domain: [0, 80] },
        y: { domain: [0, 4] },
        marks: [comets({ heading: [{ field: "id" }, " forecast"] })],
      });
      chart.root.focus();
      key(chart, "ArrowRight");
      chart.render();
      // The keyboard's tooltip is headed by the comet's own heading ...
      const [heading] = rows(chart);
      expect(heading).toMatch(/^C-1[234] forecast$/);
      // ... and its announcement says it before the comet, and keeps the place.
      expect(said(chart)).toMatch(/^C-1[234] forecast\. .* at /);
      expect(said(chart)).toContain(heading!);
    },
    "heads the keyboard's tooltip of one comet by its own heading, which it says before the place",
  );

  it("says the heading of the point the cursor reads, where the box reads another row", async () => {
    // Dodged categories with a missing value: at b the box snaps back to a's
    // row, while the cursor reads b's.
    const dodged = table({
      c: ["a", "a", "b", "b"],
      v: [10, Number.NaN, 30, 40],
      s: ["one", "two", "one", "two"],
      id: ["A-1", "A-2", "B-1", "B-2"],
    });
    const chart = await mount({
      inspection: { mode: "nearest-x", snap: "previous" },
      marks: [
        line(dodged, {
          x: "c",
          y: "v",
          series: "s",
          dodge: true,
          tooltip: { heading: [{ field: "id" }] },
        }),
      ],
    });
    chart.root.focus();
    key(chart, "ArrowRight");
    chart.render();
    expect(said(chart)).toBe("A-1. one: 10 at a");
    key(chart, "ArrowRight");
    chart.render();
    expect(said(chart)).toBe("B-1. 30 at b");
  });

  it("says a layout item's heading where its content writes no text", async () => {
    const sales = table({ region: ["Europe", "Asia"], units: [4, 5] });
    const chart = await mount({
      marks: [
        pie(sales, {
          category: "region",
          value: "units",
          tooltip: { heading: [{ field: "region" }], content: [""] },
        }),
      ],
    });
    chart.root.focus();
    key(chart, "ArrowRight");
    chart.render();
    const [heading] = rows(chart);
    expect(said(chart)).toBe(`units. ${heading}`);
    // The same words again are told apart by a space.
    key(chart, "i");
    expect(said(chart)!.trim()).toBe(`units. ${heading}`);
  });

  it("heads an item of a layout mark by its own heading", async () => {
    const sales = table({ region: ["Europe", "Asia"], units: [4, 5] });
    const chart = await mount({
      marks: [
        pie(sales, {
          id: "sales",
          category: "region",
          value: "units",
          tooltip: { heading: [{ field: "region", style: { fontWeight: 600 } }, " sales"] },
        }),
      ],
    });
    point(chart, ...itemAt(chart, "Asia"));
    expect(rows(chart)[0]).toBe("Asia sales");
    const runs = [...box(chart)!.children[0]!.children] as HTMLElement[];
    expect(runs[0]!.style.fontWeight).toBe("600");
  });

  it("heads each panel's tooltip as its own reading says, where panels show the cursor", async () => {
    const sites = table({
      t: [0, 1, 2, 0, 1, 2],
      v: [1, 2, 3, 3, 2, 1],
      site: ["north", "north", "north", "south", "south", "south"],
    });
    const chart = await mount({
      facet: facet("site"),
      x: { scope: "chart" },
      inspection: { mode: "nearest-x" },
      interaction: { sync: { panels: { tooltip: true } } },
      marks: [
        line(sites, {
          x: "t",
          y: "v",
          tooltip: {
            heading: [{ field: "site", style: { fontWeight: 600 } }, " at ", { field: "t" }],
            fields: ["v"],
          },
        }),
      ],
    });
    const [north] = chart.getPanels();
    point(chart, chart.toPixel(1, { axis: "x", panel: north!.key })!, north!.plot.y + 10);
    const shown = boxes(chart);
    expect(shown.map((div) => div.children[0]!.textContent).sort()).toEqual([
      "north at 1",
      "south at 1",
    ]);
    // Every panel's box is drawn as the chart's own: headings in their parts' styles, fields under.
    for (const div of shown) {
      expect((div.children[0]!.children[0] as HTMLElement).style.fontWeight).toBe("600");
      expect([...div.children].map((row) => row.textContent)).toContain("v2");
    }
  });

  it("keeps renderTooltip's content to the chart's own box where only another panel reads", async () => {
    // North has no row at t = 1, so the pointer there reads nothing; south does.
    const sites = table({
      t: [0, 2, 1],
      v: [1, 3, 2],
      site: ["north", "north", "south"],
    });
    const chart = await mount({
      facet: facet("site"),
      x: { scope: "chart" },
      inspection: { mode: "nearest-x", within: 0 },
      interaction: { sync: { panels: { tooltip: true } } },
      renderTooltip: () => "the application's",
      marks: [line(sites, { x: "t", y: "v", tooltip: { heading: [{ field: "site" }] } })],
    });
    const [north] = chart.getPanels();
    point(chart, chart.toPixel(1, { axis: "x", panel: north!.key })!, north!.plot.y + 10);
    const shown = boxes(chart);
    expect(shown.map((div) => div.children[0]?.textContent)).toEqual(["south"]);
    expect(shown[0]!.textContent).not.toContain("the application's");
  });

  it("carries the heading to hover events and renderTooltip, the box drawn by the application", async () => {
    const read: (string | undefined)[] = [];
    const chart = await mount({
      inspection: { mode: "nearest" },
      x: { domain: [0, 80] },
      y: { domain: [0, 4] },
      renderTooltip: ({ points: [first] }) => `own: ${texts(first?.heading)}`,
      marks: [comets({ heading: [{ field: "id" }] })],
    });
    chart.on("hover", ({ inspection }) => read.push(texts(inspection?.points[0]?.heading)));
    at(chart, 50, 3);
    expect(box(chart)!.textContent).toBe("own: C-14");
    expect(read).toContain("C-14");
  });

  it("draws the heading it is given in the box before what styles it loads", () => {
    const tooltip = new Tooltip(document);
    host.append(tooltip.element);
    const inspection = {
      axis: "x" as const,
      value: 1,
      position: 10,
      label: "11:42",
      points: [
        {
          mark: 0,
          markId: undefined,
          key: "a",
          label: "a",
          row: 0,
          color: "#f00",
          text: "1",
          value: 1,
          px: 0,
          py: 0,
        },
      ],
    };
    const size = { width: 600, height: 300 };
    tooltip.show(
      inspection,
      [{ text: "C-12", style: { fontWeight: 600 } }, { text: " rates" }],
      LIGHT,
      { x: 10, y: 10 },
      size,
    );
    const [header, row] = [...tooltip.element.children] as HTMLElement[];
    expect([header!.hidden, header!.textContent, row!.textContent]).toEqual([
      false,
      "C-12 rates",
      "a1",
    ]);
    tooltip.show(inspection, undefined, LIGHT, { x: 10, y: 10 }, size);
    expect(header!.hidden).toBe(true);
    expect(header!.offsetHeight).toBe(0);
    tooltip.show(inspection, [{ text: "11:42" }], LIGHT, { x: 10, y: 10 }, size);
    expect([header!.hidden, header!.textContent]).toEqual([false, "11:42"]);
  });
});
