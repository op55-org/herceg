import { describe, expect, it } from "vitest";
import { category } from "../../src/data/column.ts";
import { type Table, table } from "../../src/data/table.ts";
import { loadSpec, SPEC_VERSION, specToSVG, validateSpec } from "../../src/from-spec.ts";
import { estimateText } from "../../src/layout/text.ts";
import { custom } from "../../src/marks/custom.ts";
import { funnel } from "../../src/marks/funnel.ts";
import { markKey } from "../../src/marks/hidden.ts";
import type { ItemInfo, LayoutFrame } from "../../src/marks/layout-mark.ts";
import { line } from "../../src/marks/line.ts";
import type { ChartMark } from "../../src/marks/mark.ts";
import { pie } from "../../src/marks/pie.ts";
import { region } from "../../src/marks/region.ts";
import { rule } from "../../src/marks/rule.ts";
import { sankey } from "../../src/marks/sankey.ts";
import { sunburst } from "../../src/marks/sunburst.ts";
import { text } from "../../src/marks/text.ts";
import { TreemapMark, treemap } from "../../src/marks/treemap.ts";
import { facet } from "../../src/model/facet.ts";
import { type ChartConfig, ChartModel } from "../../src/model/model.ts";
import { panels } from "../../src/model/panels.ts";
import { Picker } from "../../src/model/pick.ts";
import { renderToPDF } from "../../src/pdf.ts";
import { staticCompilers } from "../../src/render/compilers.ts";
import { renderToSVG } from "../../src/render/static.ts";
import type {
  Panel,
  RectGeometry,
  RuleGeometry,
  Scene,
  ShapesGeometry,
  TextGeometry,
} from "../../src/scene/scene.ts";
import type { ChartSpec } from "../../src/spec/spec.ts";
import { legendOf } from "../helpers/guides.ts";
import { pickKit } from "../helpers/picker.ts";

// B8's Marimekko: markets as columns, segments as their cells.
const sales = table({
  market: category(["Auburn, AL", "Auburn, AL", "Birmingham, AL"]),
  segment: category(["Almond lovers", "Berry buyers", "Almond lovers"]),
  value: [3840, 1920, 1600],
});
const markets = table({
  market: category(["Auburn, AL", "Birmingham, AL", "Nowhere"]),
  total: [5760, 1600, 1],
});
const cells = () => treemap(sales, { id: "cells", path: ["market", "segment"], value: "value" });

function drawn(config: ChartConfig, width = 600, height = 400): Scene {
  const model = new ChartModel(config);
  model.setSize(width, height, 1);
  return model.scene(estimateText);
}

/** The text labels a mark's key names, by their text, with their anchor points. */
function labelsOf(panel: Panel, key: string): Map<string, [number, number]> {
  const out = new Map<string, [number, number]>();
  for (const g of panel.marks) {
    if (g.kind !== "text" || g.key !== key) continue;
    const { labels, coords } = g as TextGeometry;
    labels.forEach((label, i) => {
      out.set(label, [coords[i * 2]!, coords[i * 2 + 1]!]);
    });
  }
  return out;
}

const columnsOf = (panel: Panel) => panel.items!.list!().filter((item) => item.depth === 1);

describe("decorations of a layout mark's chart", () => {
  it("place text above each column and rules at their left edges, in the frame the treemap draws", () => {
    const scene = drawn({
      padding: { top: 28 },
      marks: [
        cells(),
        text(markets, {
          id: "names",
          from: {
            mark: "cells",
            item: [{ field: "market" }],
            at: "top-left",
            offset: { x: 3, y: -24 },
          },
          label: { field: "market" },
        }),
        rule(markets, {
          id: "edges",
          x: { item: { mark: "cells", item: [{ field: "market" }] }, at: "start" },
          stroke: "black",
        }),
      ],
    });
    const panel = scene.panels[0]!;
    const [auburn, birmingham] = columnsOf(panel) as [ItemInfo, ItemInfo];
    expect(auburn.names).toEqual(["Auburn, AL"]);
    // The label's block hangs from its anchor: its start 3 px in, its top 24 px above the column.
    const names = labelsOf(panel, '["names","text"]');
    expect([...names.keys()]).toEqual(["Auburn, AL", "Birmingham, AL"]);
    const [x, y] = names.get("Birmingham, AL")!;
    expect(x).toBeCloseTo(birmingham.box.x + 3, 3);
    expect(y).toBeGreaterThan(birmingham.box.y - 24);
    expect(y).toBeLessThan(birmingham.box.y - 24 + 12);
    expect(panel.marks.find((g) => g.key === '["names","text"]')).toMatchObject({
      anchor: "start",
    });
    // One rule a market drawn, at its column's left edge, after the treemap's geometry.
    const rules = panel.marks.filter((g) => g.kind === "rule") as RuleGeometry[];
    expect(rules.map((g) => [g.x1, g.x2])).toEqual([
      [auburn.box.x, auburn.box.x],
      [birmingham.box.x, birmingham.box.x],
    ]);
    expect(panel.marks.findIndex((g) => g.kind === "rule")).toBeGreaterThan(
      panel.marks.findIndex((g) => g.key.startsWith("treemap-leaves")),
    );
  });

  it("leave out rows whose item is not drawn, and place regions and text on items' edges", () => {
    const scene = drawn({
      marks: [
        cells(),
        region(markets, {
          x1: { item: { mark: "cells", item: [{ field: "market" }] }, at: "start" },
          x2: { item: { mark: "cells", item: [{ field: "market" }] }, at: "end" },
        }),
        text(markets, {
          id: "totals",
          x: { item: { mark: "cells", item: [{ field: "market" }] }, at: "center" },
          y: { item: { mark: "cells", item: [{ field: "market" }] }, at: "end", offset: -6 },
          label: { field: "total" },
        }),
      ],
    });
    const panel = scene.panels[0]!;
    const [auburn] = columnsOf(panel) as [ItemInfo];
    const totals = labelsOf(panel, '["totals","text"]');
    expect([...totals.keys()]).toEqual(["5,760", "1,600"]);
    expect(totals.get("5,760")).toEqual([
      expect.closeTo(auburn.box.x + auburn.box.width / 2, 3),
      expect.closeTo(auburn.box.y + auburn.box.height - 6, 3),
    ]);
    const rect = panel.marks.find((g) => g.kind === "rect" && g.key.includes('"region"'));
    expect(rect).toMatchObject({ count: 2 });
  });

  it("refuse marks along axes, naming the way in", () => {
    const series = table({ t: [1, 2], v: [1, 2] });
    expect(() => drawn({ marks: [cells(), line(series, { x: "t", y: "v" })] })).toThrow(
      "line: a treemap's chart has no x and y scales; draw the line in another chart, or place text, rules, regions, or custom marks by the treemap's items or in pixels",
    );
    expect(() => drawn({ marks: [cells(), text(series, { x: "t", y: "v", label: "x" })] })).toThrow(
      "text: a treemap's chart has no x and y scales; place it by the treemap's items ({ item: { mark, item } }) or in pixels",
    );
    // Pixels need no items.
    drawn({ marks: [cells(), text({ x: { px: 4 }, y: { px: 4 }, label: "Sales" })] });
  });

  it("refuse items of marks that are none, give no geometry, or draw elsewhere", () => {
    const at = (mark: string) => ({ item: { mark, item: [{ field: "market" as const }] } });
    expect(() => drawn({ marks: [cells(), rule(markets, { x: at("cels") })] })).toThrow(
      'rule item mark: no mark has id "cels"; give the id of the treemap it follows',
    );
    expect(() =>
      drawn({ marks: [cells(), rule(markets, { id: "edges", x: at("edges") })] }),
    ).toThrow('rule item mark: "edges" is a rule, which has no layout items');
    const flows = sankey(table({ from: ["a"], to: ["b"], v: [1] }), {
      id: "flows",
      source: "from",
      target: "to",
      value: "v",
    });
    expect(() => drawn({ marks: [flows, rule(markets, { x: at("flows") })] })).toThrow(
      'rule item mark: "flows" is a sankey, whose items give no geometry to place by',
    );
    // In a chart with axes, places on items have none to read.
    const series = table({ t: [1, 2], v: [1, 2] });
    expect(() =>
      drawn({ marks: [line(series, { x: "t", y: "v" }), rule(markets, { x: at("cells") })] }),
    ).toThrow('rule x: places on items of "cells" need it drawn in the panel');
    // Items are named by categories.
    expect(() =>
      rule(markets, { x: { item: { mark: "cells", item: [{ field: "total" as never }] } } }),
    ).toThrow(/rule x\.item\.item\[0\]\.field: .*"total"/);
    expect(() =>
      text(markets, {
        from: { mark: "cells", item: ["Auburn, AL"], at: "top-start" as never },
        label: "x",
      }),
    ).toThrow('text from.at: expected "top-left", "top"');
  });

  it("draw in facets, each panel's rows by its own items, up to half the gap beside", () => {
    const regional = table({
      location: category(["N", "N", "S"]),
      market: category(["Auburn, AL", "Birmingham, AL", "Auburn, AL"]),
      value: [1, 2, 3],
    });
    const names = table({
      location: category(["N", "N", "S"]),
      market: category(["Auburn, AL", "Birmingham, AL", "Auburn, AL"]),
    });
    const scene = drawn({
      facet: facet("location", { header: false, gap: 20 }),
      marks: [
        treemap(regional, { id: "cells", path: ["market"], value: "value" }),
        text(names, {
          id: "names",
          from: { mark: "cells", item: [{ field: "market" }], at: "top-left" },
          label: { field: "market" },
        }),
      ],
    });
    expect(scene.panels.map((p) => [...labelsOf(p, '["names","text"]').keys()])).toEqual([
      ["Auburn, AL", "Birmingham, AL"],
      ["Auburn, AL"],
    ]);
    // Its box: half the gap past its plot towards the other panel, the chart's edge on the others.
    const [north] = scene.panels as [Panel];
    const [box] = north.keep!;
    expect(box!.x).toBe(Math.max(0, north.plot.x - 10));
    expect(box!.x + box!.width).toBe(north.plot.x + north.plot.width + 10);
  });

  it("know each place of a mark listed twice in facets, hidden one at a time", () => {
    const regional = table({ location: category(["N", "S"]), market: category(["A", "B"]) });
    const note = text({ x: { px: 5 }, y: { px: 5 }, label: "Note" });
    const model = new ChartModel({
      facet: facet("location", { header: false }),
      marks: [treemap(regional, { id: "cells", path: ["market"] }), note, note],
    });
    model.setSize(600, 400, 1);
    const notes = () =>
      model
        .scene(estimateText)
        .panels.map((p) =>
          p.marks.flatMap((g) => (g.kind === "text" && g.key.startsWith("[") ? [g.key] : [])),
        );
    expect(notes()).toEqual([
      ['[1,"text"]', '[2,"text"]'],
      ['[1,"text"]', '[2,"text"]'],
    ]);
    model.hidden.add(markKey(2));
    expect(notes()).toEqual([['[1,"text"]'], ['[1,"text"]']]);
  });

  it("are picked only within their panel's box, as they are drawn", () => {
    const regional = table({
      location: category(["N", "S"]),
      market: category(["A", "B"]),
      value: [1, 2],
    });
    const model = new ChartModel({
      facet: facet("location", { header: false, gap: 20, columns: 2 }),
      marks: [
        treemap(regional, { id: "cells", path: ["market"], value: "value", labels: false }),
        // Far left of each panel's plot: in the left panel's box only for the left panel's.
        text({ id: "note", at: { x: { px: -80 }, y: { px: 40 } }, label: "note" }),
      ],
    });
    model.setSize(600, 400, 1);
    const [left, right] = model.scene(estimateText).panels as [Panel, Panel];
    const [x, y] = labelsOf(right, '["note","text"]').get("note")!;
    // The right panel's note lies over the left panel's cell, which is picked there.
    expect(x).toBeLessThan(left.plot.x + left.plot.width);
    expect(new Picker(pickKit).pick(model, { x: x + 2, y, slop: 0 })?.key).toBe("cells");
  });

  it("place by the chart's frame in facet panels, and are not cut to the plot", () => {
    const regional = table({
      location: category(["N", "S"]),
      market: category(["A", "B"]),
      value: [1, 2],
    });
    const model = new ChartModel({
      facet: facet("location", { header: false, gap: 20, columns: 2 }),
      marks: [
        treemap(regional, { id: "cells", path: ["market"], value: "value", labels: false }),
        text({ id: "note", at: { x: { px: 50, frame: "chart" }, y: { px: 40 } }, label: "note" }),
      ],
    });
    model.setSize(600, 400, 1);
    const panels = model.scene(estimateText).panels;
    expect(panels.map((p) => labelsOf(p, '["note","text"]').get("note")![0])).toEqual([50, 50]);
    // A band above the treemap, in the chart's padding.
    const banded = drawn({
      padding: { top: 40 },
      marks: [cells(), region({ id: "band", y1: { px: -30 }, y2: { px: -10 }, fill: "black" })],
    });
    const { plot, marks } = banded.panels[0]!;
    const band = marks.find(
      (g) => g.kind === "rect" && g.key.startsWith('["band"'),
    ) as RectGeometry;
    expect(band.count).toBe(1);
    expect(band.rects[1]).toBeCloseTo(plot.y - 30, 6);
    expect(band.rects[3]).toBeCloseTo(20, 6);
  });

  it("draw in a subplot beside its layout mark, and refuse marks of another panel", () => {
    const shares = table({ region: category(["eu", "us"]), v: [1, 3] });
    const layout = panels([{ id: "a" }, { id: "b" }]);
    const slices = pie(shares, { id: "slices", category: "region", value: "v", panel: "b" });
    const scene = drawn({
      panels: layout,
      marks: [
        line(table({ t: [1, 2], v: [1, 2] }), { x: "t", y: "v", panel: "a" }),
        slices,
        text(shares, {
          id: "names",
          panel: "b",
          from: { mark: "slices", item: [{ field: "region" }], at: "center" },
          label: { field: "region" },
        }),
      ],
    });
    expect([...labelsOf(scene.panels[1]!, '["names","text"]').keys()]).toEqual(["eu", "us"]);
    expect(() =>
      drawn({
        panels: layout,
        marks: [
          slices,
          text(shares, {
            panel: "a",
            from: { mark: "slices", item: [{ field: "region" }], at: "center" },
            label: "x",
          }),
        ],
      }),
    ).toThrow('text item mark: "slices" is drawn in panel "b"; draw the text there');
  });

  it("make the layout mark's items only for marks placed by them", () => {
    let made = 0;
    const counted = () => {
      const cells = new TreemapMark(
        { type: "treemap", id: "cells", path: ["market"], value: "value" },
        sales as unknown as Table,
      );
      const draw = cells.draw.bind(cells);
      cells.draw = (frame: LayoutFrame) => {
        const result = draw(frame);
        const items = result.items!;
        const counting = () => {
          made++;
          return items();
        };
        return { ...result, items: counting };
      };
      return cells;
    };
    drawn({ marks: [counted(), text({ x: { px: 5 }, y: { px: 5 }, label: "Caption" })] });
    expect(made).toBe(0);
    drawn({
      marks: [
        counted(),
        text(markets, {
          from: { mark: "cells", item: [{ field: "market" }], at: "top" },
          label: "A",
        }),
      ],
    });
    expect(made).toBeGreaterThan(0);
  });

  it("paint by zIndex: under the layout mark below 0", () => {
    const scene = drawn({
      marks: [
        cells(),
        region(markets, {
          zIndex: -1,
          x1: { item: { mark: "cells", item: [{ field: "market" }] } },
          x2: { item: { mark: "cells", item: [{ field: "market" }] }, at: "end" },
        }),
      ],
    });
    expect(scene.panels[0]!.marks[0]!.key).toContain('"region"');
  });

  it("give custom marks the items drawn before them, in static exports too, as copies", () => {
    let seen: readonly ItemInfo[] = [];
    const marks: ChartMark[] = [
      cells(),
      custom({
        draw(context) {
          seen = context.items("cells");
          for (const column of seen)
            if (column.depth === 1) context.rect(column.box.x, 0, 1, column.box.y);
          (seen[0]!.box as { x: number }).x = -100;
        },
      }),
    ];
    const svg = renderToSVG({ width: 600, height: 400, marks });
    const panel = drawn({ marks }).panels[0]!;
    expect(seen.length).toBeGreaterThan(0);
    // What the custom mark changed stays its own.
    expect(panel.items!.list!()[0]!.box.x).not.toBe(-100);
    const shapes = panel.marks.find((g) => g.kind === "shapes") as ShapesGeometry;
    expect(shapes.shapes).toHaveLength(2);
    expect(svg.match(/<path d="M[\d.]+ 0h1v/g)).toHaveLength(2);
    expect(() =>
      drawn({ marks: [cells(), custom({ draw: (context) => context.items("nope") })] }),
    ).toThrow('custom items: no layout mark "nope" is drawn in this panel');
  });

  it("keep the layout mark's own index when listed before it", () => {
    const shares = table({ region: category(["N", "S"]), sales: [1, 3] });
    const model = new ChartModel({
      marks: [
        text({ id: "note", at: { x: { px: 4 }, y: { px: 4 } }, label: "Shares" }),
        pie(shares, { category: "region", value: "sales", labels: false }),
      ],
    });
    model.setSize(600, 400, 1);
    const scene = model.scene(estimateText);
    const [south] = scene.panels[0]!.items!.list!() as [ItemInfo];
    expect(JSON.parse(south.key)[0]).toBe(1);
    const { cx, cy, outerRadius } = south.sector!;
    const found = model.inspect(cx + outerRadius / 2, cy, "nearest");
    expect(found?.points[0]).toMatchObject({ mark: 1, markId: undefined });
  });

  it("list annotations by their labels in a chart of one layout mark's legend", () => {
    const model = new ChartModel(
      {
        marks: [
          pie(table({ region: category(["N", "S"]), sales: [1, 3] }), {
            category: "region",
            value: "sales",
          }),
          rule({ x: { px: 50 }, label: "Target", legend: true }),
        ],
      },
      undefined,
      ...staticCompilers(),
    );
    model.setSize(600, 400, 1);
    expect(legendOf(model.scene(estimateText)).map(({ label }) => label)).toEqual([
      "S",
      "N",
      "Target",
    ]);
  });

  it("draw nothing by the items of a layout mark hidden whole", () => {
    const shares = table({ region: category(["N", "S"]), sales: [1, 2] });
    let read = -1;
    const model = new ChartModel({
      marks: [
        pie(shares, { id: "slices", category: "region", value: "sales", labels: false }),
        text(shares, {
          id: "names",
          from: { mark: "slices", item: [{ field: "region" }], at: "center" },
          label: { field: "region" },
        }),
        custom({
          draw(context) {
            read = context.items("slices").length;
          },
        }),
      ],
    });
    model.setSize(600, 400, 1);
    for (const { key } of legendOf(model.scene(estimateText))) model.hidden.add(key);
    model.hidden.add(markKey("slices"));
    const panel = model.scene(estimateText).panels[0]!;
    expect([...labelsOf(panel, '["names","text"]').keys()]).toEqual([]);
    expect(read).toBe(0);
    expect(panel.items!.list!()).toEqual([]);
  });

  it("export anchors to SVG and PDF", () => {
    const options = {
      width: 600,
      height: 400,
      padding: { top: 28 },
      marks: [
        cells(),
        text(markets, {
          from: { mark: "cells", item: [{ field: "market" }], at: "top-left", offset: { y: -20 } },
          label: { field: "market" },
        }),
      ],
    };
    const svg = renderToSVG(options);
    expect(svg).toContain(">Birmingham, AL</text>");
    expect(svg).not.toContain(">Nowhere<");
    const pdf = Buffer.from(renderToPDF(options)).toString("latin1");
    expect(pdf.startsWith("%PDF-")).toBe(true);
  });
});

describe("layout items' geometry", () => {
  it("gives pies' slices as sectors from 12 o'clock, clockwise, with their boxes", () => {
    const scene = drawn({
      marks: [pie(table({ c: category(["a", "b"]), v: [1, 3] }), { category: "c", value: "v" })],
    });
    const [b, a] = scene.panels[0]!.items!.list!() as [ItemInfo, ItemInfo];
    expect(b).toMatchObject({ names: ["b"], value: 3 });
    expect(b.sector!.startAngle).toBeCloseTo(0, 9);
    expect(b.sector!.endAngle).toBeCloseTo(1.5 * Math.PI, 9);
    expect(a.sector!.startAngle).toBeCloseTo(1.5 * Math.PI, 9);
    // The quarter from 9 to 12 o'clock: its box is the top left quarter of the circle.
    const { cx, cy, outerRadius } = a.sector!;
    expect(a.box.x).toBeCloseTo(cx - outerRadius, 6);
    expect(a.box.y).toBeCloseTo(cy - outerRadius, 6);
    expect(a.box.width).toBeCloseTo(outerRadius, 6);
  });

  it("gives only the items drawn: none too thin to show, none of a pie without room", () => {
    // Thinner than a gap, or than 32-bit angles, whose sector is drawn from, tell apart.
    for (const v of [1e-30, 1e-9]) {
      const thin = table({ c: category(["a", "b"]), v: [1, v] });
      const one = drawn({ marks: [pie(thin, { category: "c", value: "v", labels: false })] });
      expect(one.panels[0]!.items!.list!().map(({ names }) => names)).toEqual([["a"]]);
      const ring = drawn({ marks: [sunburst(thin, { path: ["c"], value: "v", labels: false })] });
      expect(ring.panels[0]!.items!.list!().map(({ names }) => names)).toEqual([["a"]]);
    }
    // Stages narrower than 32-bit floats hold, or of nothing at all.
    for (const v of [
      [1, 1e-50],
      [0, 0],
    ]) {
      const stages = table({ c: category(["a", "b"]), v });
      const list = drawn({ marks: [funnel(stages, { category: "c", value: "v", labels: false })] })
        .panels[0]!.items!.list!();
      expect(list.map(({ names }) => names)).toEqual(v[0] ? [["a"]] : []);
    }
    const thin = table({ c: category(["a", "b"]), v: [1, 1e-30] });
    const none = drawn({ marks: [pie(thin, { category: "c", value: "v" })] }, 4, 4);
    expect(none.panels[0]!.items!.list!()).toEqual([]);
  });

  it("gives funnels' stages and sunbursts' rings, with depth and parents", () => {
    const stages = drawn({
      marks: [funnel(table({ s: category(["a", "b"]), v: [4, 2] }), { category: "s", value: "v" })],
    }).panels[0]!.items!.list!();
    expect(stages.map((s) => [s.names, s.box.width > 0])).toEqual([
      [["a"], true],
      [["b"], true],
    ]);
    const rings = drawn({
      marks: [sunburst(sales, { id: "rings", path: ["market", "segment"], value: "value" })],
    }).panels[0]!.items!.list!();
    // In reading order, as the keyboard visits them: each node, then its children, the larger first.
    expect(rings.map(({ names }) => names.join(" / "))).toEqual([
      "Auburn, AL",
      "Auburn, AL / Almond lovers",
      "Auburn, AL / Berry buyers",
      "Birmingham, AL",
      "Birmingham, AL / Almond lovers",
    ]);
    const leaf = rings.find((item) => item.names.length === 2)!;
    const parent = rings.find((item) => item.key === leaf.parent)!;
    expect(parent.names).toEqual([leaf.names[0]]);
    expect([parent.depth, leaf.depth]).toEqual([1, 2]);
    expect(leaf.sector!.innerRadius).toBeCloseTo(parent.sector!.outerRadius, 9);
  });
});

describe("item places in specs", () => {
  const spec = (): ChartSpec => ({
    version: SPEC_VERSION,
    data: {
      sales: {
        columns: {
          market: {
            type: "category",
            codes: [0, 0, 1],
            dictionary: ["Auburn, AL", "Birmingham, AL"],
          },
          segment: {
            type: "category",
            codes: [0, 1, 0],
            dictionary: ["Almond lovers", "Berry buyers"],
          },
          value: [3840, 1920, 1600],
        },
      },
      markets: {
        columns: {
          market: { type: "category", codes: [0, 1], dictionary: ["Auburn, AL", "Birmingham, AL"] },
        },
      },
    },
    padding: { top: 28 },
    marks: [
      { type: "treemap", id: "cells", data: "sales", path: ["market", "segment"], value: "value" },
      {
        type: "text",
        data: "markets",
        label: { field: "market" },
        from: {
          mark: "cells",
          item: [{ field: "market" }],
          at: "top-left",
          offset: { x: 3, y: -24 },
        },
      },
      {
        type: "rule",
        data: "markets",
        x: { item: { mark: "cells", item: [{ field: "market" }] }, at: "start" },
      },
    ],
  });

  it("load and draw text from items and rules at items' edges", () => {
    const input = spec();
    expect(() => validateSpec(input)).not.toThrow();
    const loaded = loadSpec(input, [], { unknown: "error" });
    expect(loaded.unknown).toEqual([]);
    expect(specToSVG(input)).toContain(">Birmingham, AL</text>");
  });

  it.each([
    [{ x: { item: { mark: "cells", item: [] } } }, /x\.item\.item: expected a list of names/],
    [{ x: { item: { mark: "cells", item: [{ field: "market" }] }, at: "middle" } }, /x\.at/],
    [{ x: { item: { mark: "cells", item: [{ name: "market" }] } } }, /x\.item\.item\[0\]/],
    [{ x: { item: { item: ["Auburn, AL"] } } }, /x\.item\.mark/],
  ])("refuse malformed item places: %j", (place, error) => {
    const input = spec();
    (input.marks as unknown[])[2] = { type: "rule", data: "markets", ...place };
    expect(() => validateSpec(input)).toThrow(error);
  });

  it("check labels of text by items as of text at a place, not of series labels", () => {
    const input = spec();
    const text = input.marks[1] as { label: unknown };
    text.label = { text: "note", overlap: "hide", overlapGroup: "notes" };
    expect(() => validateSpec(input)).not.toThrow();
    expect(specToSVG(input)).toContain(">note</text>");
    text.label = { text: "note", place: { outside: true } };
    expect(() => validateSpec(input)).toThrow(
      "marks[1].label.place: text at a place is drawn there; drop place",
    );
  });

  it("refuse a malformed anchor", () => {
    const input = spec();
    (input.marks[1] as { from: { at: string } }).from.at = "top-start";
    expect(() => validateSpec(input)).toThrow(/from\.at/);
  });
});
