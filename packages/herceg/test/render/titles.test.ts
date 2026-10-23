// Native titles in static SVG (render/titles.ts): the drawing as the SVG
// writer packs it, then an invisible target with the tooltip's text for
// each bar, point, and observation of a line, in paint order, and
// refusals past the budget.
import { describe, expect } from "vitest";
import { col } from "../../src/data/expr.ts";
import { RowSet } from "../../src/data/row-set.ts";
import { selectionStore, selectRows } from "../../src/data/selection.ts";
import { type Table, table } from "../../src/data/table.ts";
import { estimateText } from "../../src/layout/text.ts";
import { bar } from "../../src/marks/bar.ts";
import { line } from "../../src/marks/line.ts";
import { point } from "../../src/marks/point.ts";
import { facet } from "../../src/model/facet.ts";
import { Highlighter } from "../../src/model/highlight.ts";
import { type ChartConfig, ChartModel } from "../../src/model/model.ts";
import { rowSelection } from "../../src/model/row-selection.ts";
import { staticCompilers } from "../../src/render/compilers.ts";
import { NO_PAGE } from "../../src/render/fallbacks.ts";
import { renderSvg } from "../../src/render/svg.ts";
import { titlesOf } from "../../src/render/titles.ts";
import { ChartError } from "../../src/spec/errors.ts";
import { contractTest } from "../helpers/contracts.ts";

function render(config: Omit<ChartConfig, "locale">, budget?: number) {
  const model = new ChartModel(
    { locale: "en-US", timeZone: "UTC", legend: false, ...config },
    NO_PAGE,
    ...staticCompilers(),
  );
  model.setSize(400, 300, 1);
  const plain = renderSvg(model.scene(estimateText), { idPrefix: "t" });
  const { scene, titles } = titlesOf(model, estimateText, budget === undefined ? {} : { budget });
  return { plain, titled: renderSvg(scene, { idPrefix: "t", titles }) };
}

/** The titles in `svg`, in order. */
const titles = (svg: string) =>
  [...svg.matchAll(/<title>([^<]*)<\/title>/g)].map(([, text]) => text!.replaceAll("&#10;", "\n"));

/** `svg` without its titled targets. */
const untargeted = (svg: string) =>
  svg.replace(
    /<(circle|path|g)\b[^>]*pointer-events="all"><title>[^<]*<\/title>(?:<path [^>]*\/>)*<\/\1>/g,
    "",
  );

const targets = (svg: string, shape: "circle" | "path" | "g") =>
  svg.match(new RegExp(`<${shape} [^>]*fill="none" pointer-events="all"><title>`, "g")) ?? [];

describe("titles in static SVG", () => {
  contractTest("svg.titles.points", () => {
    const rows = table({ x: [1, 2, 3], y: [10, 20, 30], kind: ["a", "b", "a"] });
    const { plain, titled } = render({ marks: [point(rows, { x: "x", y: "y", series: "kind" })] });
    // A target per point, its title the tooltip's text: where it is, its series and value.
    expect(titles(titled)).toEqual(["1\na: 10", "3\na: 30", "2\nb: 20"]);
    expect(targets(titled, "path")).toHaveLength(3);
    // The drawing as it is without titles.
    expect(untargeted(titled)).toBe(plain);
    expect(titles(plain)).toEqual([]);
  });

  contractTest("svg.titles.bars", () => {
    const rows = table({ c: ["north", "south"], v: [5, 7] });
    const { plain, titled } = render({ marks: [bar(rows, { x: "c", y: "v" })] });
    expect(titles(titled)).toEqual(["north\nv: 5", "south\nv: 7"]);
    expect(targets(titled, "path")).toHaveLength(2);
    expect(untargeted(titled)).toBe(plain);
  });

  contractTest("svg.titles.lines", () => {
    const rows = table({ t: [0, 1, 2], v: [3, 1, 2] });
    const { plain, titled } = render({ marks: [line(rows, { x: "t", y: "v" })] });
    // The line as it is, and an invisible target at each observation.
    expect(untargeted(titled)).toBe(plain);
    expect(targets(titled, "circle")).toHaveLength(3);
    expect(titles(titled)).toEqual(["0\nv: 3", "1\nv: 1", "2\nv: 2"]);
  });

  contractTest("svg.titles.lines.clip", () => {
    // Observations drawn past the plot, by lines not cut to it, have targets too.
    const rows = table({ t: [0, 1, 2], v: [3, 10.25, 2] });
    const drawn = (clip?: "chart" | false) =>
      targets(
        render({
          y: { domain: [0, 10] },
          marks: [line(rows, { x: "t", y: "v", ...(clip === undefined ? {} : { clip }) })],
        }).titled,
        "circle",
      ).length;
    expect(drawn()).toBe(2);
    expect(drawn("chart")).toBe(3);
    expect(drawn(false)).toBe(3);
  });

  contractTest("svg.titles.rows", () => {
    // Points at one place each say their own row: the larger one's target
    // is under the smaller one's, reached where it shows around it.
    const rows = table({ x: [1, 1], y: [1, 1], size: [10, 2] });
    const { titled } = render({ marks: [point(rows, { x: "x", y: "y", size: "size" })] });
    // Circles start at their left edge: the larger's further left.
    const [big, small] = targets(titled, "path").map((t) => Number(t.match(/ d="M([\d.]+)/)![1]));
    expect(big).toBeLessThan(small!);
    expect(titles(titled).map((title) => title.match(/size:? (\d+)/)![1])).toEqual(["10", "2"]);
  });

  contractTest("svg.titles.order", () => {
    // Opaque points of several colors paint color by color, and their
    // targets follow in that order; the drawing stays packed.
    const rows = table({ x: [1, 2, 3, 4], y: [1, 2, 3, 4], c: [9, 1, 9, 1] });
    const { plain, titled } = render({ marks: [point(rows, { x: "x", y: "y", color: "c" })] });
    expect(untargeted(titled)).toBe(plain);
    const xs = targets(titled, "path").map((t) => Number(t.match(/ d="M([\d.]+)/)![1]));
    // Rows 1 and 3 (one color), then 2 and 4, or the other way round: never interleaved.
    const ranks = xs.map((x) => [...xs].sort((a, b) => a - b).indexOf(x));
    expect([
      [0, 2, 1, 3],
      [1, 3, 0, 2],
    ]).toContainEqual(ranks);
  });

  contractTest("svg.titles.symbols", () => {
    // A point's target is its symbol, with its outline's width around it.
    const rows = table({ x: [1, 2], y: [1, 2], shape: ["a", "b"] });
    const { plain, titled } = render({
      marks: [point(rows, { x: "x", y: "y", symbol: "shape", stroke: "#000000", strokeWidth: 2 })],
    });
    const drawn = [...plain.matchAll(/<path d="([^"]*)"[^>]*stroke-width="2"/g)].map(([, d]) => d);
    const shapes = targets(titled, "path").map((t) => t.match(/ d="([^"]*)"/)![1]);
    // A symbol each, as drawn: one circle of arcs, one polygon.
    expect(shapes.some((d) => d!.includes("a"))).toBe(true);
    expect(shapes.some((d) => d!.includes("L"))).toBe(true);
    for (const d of shapes) expect(drawn.join("")).toContain(d!.slice(0, 12));
    for (const t of targets(titled, "path"))
      expect(t).toContain('stroke-width="2" stroke-linejoin="round"');
  });

  contractTest("svg.titles.outline", () => {
    // A bar's target is all it paints: its outline beyond its fill too,
    // of the sides it strokes.
    const rows = table({ c: ["a"], v: [5] });
    const outlined = (options: object) =>
      render({
        marks: [bar(rows, { x: "c", y: "v", stroke: "#000000", strokeWidth: 12, ...options })],
      }).titled;
    expect(targets(outlined({}), "path")[0]).toContain('stroke-width="12"');
    const capped = outlined({ strokeSides: ["top"] });
    const [group] = capped.match(/<g [^>]*pointer-events="all">[\s\S]*?<\/g>/)!;
    const [fill, top] = [...group.matchAll(/<path d="([^"]*)"([^>]*)\/>/g)];
    // The fill, then the top side alone, as wide as it is stroked.
    expect(fill![2]).not.toContain("stroke-width");
    expect(top![1]!.match(/[ML]/g)).toHaveLength(2);
    expect(top![2]).toContain('stroke-width="12"');
  });

  contractTest("svg.titles.facets", () => {
    // Each panel's targets say its own rows, however many it draws.
    const rows = table({
      x: [1, 2, 3, 1, 2],
      y: [10, 20, 30, 40, 50],
      g: ["a", "a", "a", "b", "b"],
    });
    for (const make of [point, bar, line] as const) {
      const { titled } = render({ facet: facet("g"), marks: [make(rows, { x: "x", y: "y" })] });
      const values = titles(titled).map((title) => title.split(": ")[1]);
      expect(values, make.name).toEqual(["10", "20", "30", "40", "50"]);
    }
  });

  contractTest("svg.titles.looks", () => {
    // Bars of looks of their own (a geometry per look) have targets too,
    // counted toward the budget.
    const rows = table({ c: ["a", "b", "c", "d"], v: [5, 1, 7, 2] });
    const marks = [
      bar(rows, {
        x: "c",
        y: "v",
        encode: {
          // biome-ignore lint/suspicious/noThenProperty: a condition's branch, as specs name it.
          opacity: { condition: { when: col("v").gt(4), then: 1, otherwise: 0.4 } },
        },
      }),
    ];
    const { plain, titled } = render({ marks });
    expect(untargeted(titled)).toBe(plain);
    expect(titles(titled).sort()).toEqual(["a\nv: 5", "b\nv: 1", "c\nv: 7", "d\nv: 2"]);
    expect(() => render({ marks }, 3)).toThrow(ChartError);
  });

  contractTest("svg.titles.markers", () => {
    // A line's targets go over its markers, which would take the pointer.
    const rows = table({ t: [0, 1, 2], v: [3, 1, 2] });
    const { titled } = render({ marks: [line(rows, { x: "t", y: "v", markers: true })] });
    // The markers' path: three circles of arcs.
    const markers = titled.search(/<path d="(M[^"]*a[^"]*){3}" fill=/);
    expect(markers).toBeGreaterThan(0);
    expect(titled.indexOf('pointer-events="all"')).toBeGreaterThan(markers);
    expect(targets(titled, "circle")).toHaveLength(3);
  });

  contractTest("svg.titles.highlight", () => {
    // A chart highlighting a selection draws its rows in parts, each of
    // which keeps its rows' titles.
    const rows = table({ x: [1, 2, 3], y: [10, 20, 30] });
    for (const make of [point, bar, line] as const) {
      const store = selectionStore(rows);
      const highlighter = new Highlighter([
        { table: rows as unknown as Table, store: store as never, channel: "focus" },
      ]);
      const model = new ChartModel(
        {
          locale: "en-US",
          timeZone: "UTC",
          legend: false,
          marks: [make(rows, { x: "x", y: "y" })],
        },
        NO_PAGE,
        ...staticCompilers(),
      );
      model.setSize(400, 300, 1);
      model.highlight = (mark, series, frame, key) =>
        highlighter.geometry(mark, series, frame, key) ?? mark.geometry(series, frame, key);
      store.set("focus", selectRows(new RowSet(rows).add(1)));
      const { scene, titles: titled } = titlesOf(model, estimateText);
      const values = titles(renderSvg(scene, { idPrefix: "t", titles: titled }))
        .map((title) => title.split(": ")[1])
        .sort();
      expect(values, make.name).toEqual(["10", "20", "30"]);
    }
  });

  contractTest("svg.titles.fields", () => {
    // Titles say the fields a tooltip shows, labeled and formatted.
    const rows = table({ x: [1], y: [2], tag: ["edge"], requests: [1234.5] });
    const { titled } = render({
      marks: [
        point(rows, {
          x: "x",
          y: "y",
          tooltip: { fields: ["tag", { field: "requests", label: "Requests" }] },
        }),
      ],
    });
    expect(titles(titled)).toEqual(["1\ny: 2, tag: edge, Requests: 1,234.5"]);
  });

  contractTest("svg.titles.lines.highlight", () => {
    // A line's highlighted observations take the pointer over coincident others.
    const walk = table({ x: [1, 1, 2], y: [5, 5, 0], tag: ["lit", "dim", "end"] });
    const store = selectionStore(walk);
    const selection = rowSelection({ store, channel: "focus" });
    const model = new ChartModel(
      {
        locale: "en-US",
        timeZone: "UTC",
        legend: false,
        marks: [line(walk, { x: "x", y: "y", tooltip: { fields: ["tag"] } })],
        rowSelection: selection,
      },
      NO_PAGE,
      ...staticCompilers(),
    );
    model.setSize(400, 300, 1);
    selection.highlight(model);
    store.set("focus", selectRows(new RowSet(walk).add(0)));
    const { scene, titles: titled } = titlesOf(model, estimateText);
    const order = titles(renderSvg(scene, { idPrefix: "t", titles: titled })).map(
      (title) => title.match(/tag: (\w+)/)![1],
    );
    expect(order.indexOf("lit")).toBeGreaterThan(order.indexOf("dim"));
  });

  contractTest("svg.titles.lines.series", () => {
    // Two lines over each other, one observation of the first selected: the
    // second's targets over the first's dimmed ones, under its selected one.
    const two = table({
      x: [0, 1, 0, 1],
      y: [5, 5, 5, 5],
      s: ["a", "a", "b", "b"],
      tag: ["a0", "a1", "b0", "b1"],
    });
    const store = selectionStore(two);
    const selection = rowSelection({ store, channel: "focus" });
    const model = new ChartModel(
      {
        locale: "en-US",
        timeZone: "UTC",
        legend: false,
        marks: [line(two, { x: "x", y: "y", series: "s", tooltip: { fields: ["tag"] } })],
        rowSelection: selection,
      },
      NO_PAGE,
      ...staticCompilers(),
    );
    model.setSize(400, 300, 1);
    selection.highlight(model);
    store.set("focus", selectRows(new RowSet(two).add(1)));
    const { scene, titles: titled } = titlesOf(model, estimateText);
    const order = titles(renderSvg(scene, { idPrefix: "t", titles: titled })).map(
      (title) => title.match(/tag: (\w+)/)![1],
    );
    expect(order.indexOf("a0")).toBeLessThan(order.indexOf("b0"));
    expect(order.indexOf("a1")).toBeLessThan(order.indexOf("b1"));
    // A run and a lone row of the first selected: each under the second's.
    const four = table({
      x: [0, 1, 2, 3, 0, 1, 2, 3],
      y: [5, 5, 5, 5, 5, 5, 5, 5],
      s: ["a", "a", "a", "a", "b", "b", "b", "b"],
      tag: ["a0", "a1", "a2", "a3", "b0", "b1", "b2", "b3"],
    });
    const fourStore = selectionStore(four);
    const fourSelection = rowSelection({ store: fourStore, channel: "focus" });
    const both = new ChartModel(
      {
        locale: "en-US",
        timeZone: "UTC",
        legend: false,
        marks: [line(four, { x: "x", y: "y", series: "s", tooltip: { fields: ["tag"] } })],
        rowSelection: fourSelection,
      },
      NO_PAGE,
      ...staticCompilers(),
    );
    both.setSize(400, 300, 1);
    fourSelection.highlight(both);
    fourStore.set("focus", selectRows(new RowSet(four).addAll([0, 1, 3])));
    const drawn = titlesOf(both, estimateText);
    const after = titles(renderSvg(drawn.scene, { idPrefix: "t", titles: drawn.titles })).map(
      (title) => title.match(/tag: (\w+)/)![1],
    );
    for (const k of [0, 1, 3]) expect(after.indexOf(`a${k}`)).toBeLessThan(after.indexOf(`b${k}`));
  });

  contractTest("svg.titles.budget", () => {
    // Targets count, not rows: a long line zoomed to a few observations has few.
    const many = table({
      t: Array.from({ length: 1000 }, (_, i) => i),
      v: Array.from({ length: 1000 }, (_, i) => i % 7),
    });
    const zoomed = render({ x: { domain: [10, 13] }, marks: [line(many, { x: "t", y: "v" })] }, 10);
    expect(targets(zoomed.titled, "circle").length).toBeLessThanOrEqual(10);
    try {
      render({ marks: [point(table({ x: [1, 2, 3], y: [1, 2, 3] }), { x: "x", y: "y" })] }, 2);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ChartError);
      expect((error as ChartError).code).toBe("unsupported");
      expect((error as Error).message).toMatch(/^chart tooltip: titles in SVG go on at most 2 /);
    }
  });
});
