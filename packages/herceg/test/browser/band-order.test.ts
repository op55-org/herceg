// Category axes' band order in a browser: a listed `domain` orders the live
// chart's bands, keeps a band for each listed category without rows, holds
// them in place as groups a filter empties come and go, and orders what the
// pointer, the keyboard, and clicks read; static SVG draws the same.
import "./interactive.ts";
import { expect } from "vitest";
import { sum } from "../../src/data/aggregations.ts";
import { category } from "../../src/data/column.ts";
import { col } from "../../src/data/expr.ts";
import { groupRows } from "../../src/data/groups.ts";
import { rowView } from "../../src/data/row-view.ts";
import { table } from "../../src/data/table.ts";
import type { Chart, ChartOptions } from "../../src/dom/chart.ts";
import { measurer } from "../../src/dom/measurers.ts";
import { bar } from "../../src/marks/bar.ts";
import { renderToSVG } from "../../src/render/static.ts";
import { contractTest } from "../helpers/contracts.ts";
import { frame, heard, host, key, mount, pointer } from "./interaction/helpers.ts";

const REGIONS = ["North", "South", "East", "West"];
const LISTED = ["West", "Central", "East", "South", "North"];

/** Two years of sales by region, in REGIONS order each year. */
const sales = () =>
  table({
    region: category([...REGIONS, ...REGIONS]),
    year: category(["2024", "2024", "2024", "2024", "2025", "2025", "2025", "2025"]),
    revenue: [1, 2, 3, 4, 5, 6, 7, 8],
  });

/** Where band `name` is centered along x, in the chart's pixels. */
const at = (chart: Chart, name: string) => {
  const { x } = chart.getPanels()[0]!;
  return chart.toPixel(x!.categories!.indexOf(name), { axis: "x" })!;
};
const bottom = (chart: Chart) => {
  const { plot } = chart.getPanels()[0]!;
  return plot.y + plot.height - 2;
};

contractTest(
  "axis.bands.order.live",
  async () => {
    const rows = rowView(sales());
    const byRegion = groupRows(rows, { by: ["region"], ops: { revenue: sum("revenue") } });
    const chart = await mount(
      {
        x: { domain: LISTED },
        marks: [bar(byRegion.table, { x: "region", y: "revenue" })],
        interaction: { select: "items" },
      },
      host(400, 300),
    );
    const { x } = chart.getPanels()[0]!;
    expect(x!.categories).toEqual(LISTED);
    const centers = LISTED.map((name) => at(chart, name));
    expect(centers).toEqual([...centers].sort((a, b) => a - b));

    // The pointer names the band it is in, and the tooltip reads it.
    const hovers = heard(chart, "hover");
    for (const name of REGIONS) {
      pointer(chart, "pointermove", at(chart, name), bottom(chart));
      await frame();
      expect(hovers.at(-1)?.pointer?.categories?.x, `over ${name}`).toBe(name);
      expect(hovers.at(-1)?.inspection?.label, `reading ${name}`).toBe(name);
    }
    pointer(chart, "pointerleave", 0, 0);

    // The keyboard steps through the bars in the listed order, past the empty band.
    chart.root.focus();
    const read: string[] = [];
    for (let i = 0; i < 4; i++) {
      key(chart, "ArrowRight");
      await frame();
      read.push(hovers.at(-1)?.inspection?.label ?? "");
    }
    expect(read).toEqual(["West", "East", "South", "North"]);
    key(chart, "Escape");

    // A click selects the bar of the band it is in.
    const selects = heard(chart, "select");
    for (const type of ["pointerdown", "pointerup"])
      pointer(chart, type, at(chart, "East"), bottom(chart));
    await frame();
    expect(selects.at(-1)?.conditions[0]?.condition).toEqual(["==", ["field", "region"], "East"]);

    // A filter empties three groups, and its clear brings them back after
    // West: the bands stay listed, each bar where it was.
    rows.setQuery({ filter: col("region").eq("West") });
    await frame();
    expect(chart.getPanels()[0]!.x!.categories).toEqual(LISTED);
    rows.setQuery({ filter: true });
    await frame();
    expect(byRegion.table.categories("region").dictionary).toEqual([
      "West",
      "North",
      "South",
      "East",
    ]);
    expect(chart.getPanels()[0]!.x!.categories).toEqual(LISTED);
    expect(LISTED.map((name) => at(chart, name))).toEqual(centers);
  },
  "order the live chart's bands, what input reads, and bars through a filter and its clear",
);

contractTest(
  "axis.bands.order.export",
  async () => {
    const measure = measurer(document);
    for (const renderer of ["svg", "canvas"] as const) {
      const options = {
        animation: false,
        x: { domain: LISTED },
        marks: [bar(sales(), { x: "region", y: "revenue", series: "year" })],
      } satisfies ChartOptions;
      const live = await mount({ ...options, renderer }, host(400, 300));
      const sized = { ...options, width: 400, height: 300 };
      const ids = (text: string) => text.replace(/herceg-(svg-)?\d+-(export-)?/g, "");
      expect(ids(renderToSVG(sized, { measureText: measure })), renderer).toBe(ids(live.toSVG()));
      const labels = [...live.toSVG().matchAll(/>(North|South|East|West|Central)</g)].map(
        (m) => m[1],
      );
      expect(labels, renderer).toEqual(LISTED);
    }
  },
  "draw static SVG as the live chart draws its listed bands",
);
