// herceg/web's specs loaded with the code they name: every mark row of the
// capability matrix reaching its family and drawing as `specToSVG` draws
// it, spec features loaded only where a spec names them, each family
// imported once however many specs need it, and failures that name the
// mark whose code did not load, then let a later spec try again.
import { afterEach, describe, expect, it } from "vitest";
import rows from "../../../../test/contracts/fixtures/rows.json";
import { lineage } from "../../src/model/lineage-kit.ts";
import { type StaticOptions, svgFor } from "../../src/render/static.ts";
import { ChartError } from "../../src/spec/errors.ts";
import { loadSpec } from "../../src/spec/load.ts";
import type { ChartSpec, MarkSpec } from "../../src/spec/spec.ts";
import {
  type Family,
  familiesOf,
  forgetFamilies,
  loadSpecWithFamilies,
} from "../../src/web/families.ts";
import { loadPayload } from "../../src/web/load.ts";
import { encodePayload } from "../../src/web/payload.ts";
import { specOf } from "../contracts/matrix.ts";

afterEach(() => forgetFamilies());

/** A spec's chart as static SVG, its ids numbered alike. */
function drawn(config: object): string {
  return svgFor("test", { ...config, width: 400, height: 300 } as StaticOptions, {
    idPrefix: "c",
  });
}

/** The imports of a page, counted by family. */
function counted(): Map<Family, number> {
  const imports = new Map<Family, number>();
  forgetFamilies((family, load) => {
    imports.set(family, (imports.get(family) ?? 0) + 1);
    return load();
  });
  return imports;
}

const line: MarkSpec = { type: "line", data: "d", x: "x", y: "y" };
const d = { d: { columns: { x: [0, 1, 2], y: [1, 3, 2], g: ["a", "b", "a"] } } };

describe("specs in herceg/web", () => {
  it("draw every mark row as specToSVG does, with its family's code", async () => {
    const markRows = Object.keys(rows.rows).filter((row) => specOf(row));
    expect(markRows.length).toBeGreaterThan(35);
    for (const row of markRows) {
      const spec = specOf(row)!;
      const loaded = await loadSpecWithFamilies(spec);
      expect(drawn(loaded.config), row).toBe(drawn(loadSpec(spec).config));
    }
  });

  it("name the families of their marks, none for series and annotations", () => {
    const of = (...types: string[]) =>
      [
        ...familiesOf({
          data: d,
          marks: types.map((type) => ({ type, data: "d" }) as MarkSpec),
        }).keys(),
      ].sort();
    expect(
      of(
        "line",
        "area",
        "bar",
        "point",
        "rule",
        "region",
        "text",
        "errorbar",
        "candlestick",
        "rug",
      ),
    ).toEqual([]);
    expect(of("segment")).toEqual(["shapes"]);
    expect(of("histogram", "boxplot", "boxen", "violin")).toEqual(["distributions"]);
    expect(of("heatmap", "contour", "dendrogram")).toEqual(["matrix"]);
    expect(of("pie", "funnel", "gauge", "radar", "treemap", "sunburst", "sankey")).toEqual([
      "layouts",
    ]);
    expect(of("graph")).toEqual(["networks"]);
    expect(of("geoshape", "geopoint")).toEqual(["maps"]);
    expect(of("point3d", "line3d", "surface")).toEqual(["three-d"]);
    // A mixed dashboard: series with a heatmap and a pie.
    expect(of("line", "heatmap", "pie")).toEqual(["layouts", "matrix"]);
    // A type the format lacks is the validator's to refuse.
    expect(of("contuor")).toEqual([]);
  });

  it("name the code of the features they use, and lineage only where tables come from others", () => {
    const of = (spec: object) =>
      Object.fromEntries(familiesOf({ data: d, marks: [line], ...spec } as ChartSpec));
    expect(of({})).toEqual({});
    expect(of({ facet: { field: "g" } })).toEqual({ panels: "facet" });
    expect(of({ panels: [{ id: "a" }] })).toEqual({ panels: "panels" });
    expect(of({ navigator: true })).toEqual({ navigator: "navigator" });
    expect(of({ x: { breaks: [{ weekdays: ["sat", "sun"] }] } })).toEqual({ breaks: "x.breaks" });
    const view = { source: "d", view: { filter: [">", ["field", "y"], 1] } };
    expect(of({ data: { ...d, v: view } as unknown as ChartSpec["data"] })).toEqual({
      tables: "data.v",
    });
    const following = { source: "d", view: { selection: { excluding: "a" } } };
    expect(of({ data: { ...d, v: following } as unknown as ChartSpec["data"] })).toEqual({
      tables: "data.v",
      selection: "data.v.view.selection",
    });
    // A binding of a table no other table comes from needs no lineage.
    expect(of({ rowSelection: { channel: "a", data: "d" } })).toEqual({
      selection: "rowSelection",
    });
    const groups = { source: "d", groups: { by: ["g"], ops: { n: { op: "count" } } } };
    const totals = { source: "d", totals: { ops: { n: { op: "count" } } } };
    const derived = { source: "d", transform: [{ filter: [">", ["field", "y"], 1] }] };
    for (const entry of [groups, totals, derived])
      expect(
        of({
          data: { ...d, e: entry } as unknown as ChartSpec["data"],
          rowSelection: { channel: "a" },
        }),
      ).toEqual({ tables: "data.e", selection: "rowSelection", lineage: "rowSelection's lineage" });
    // Tables given in place of entries, which came from others.
    const given = loadSpec({
      data: { ...d, e: groups },
      marks: [{ type: "bar", data: "e", x: "g", y: "n" }],
    } as unknown as ChartSpec).tables;
    expect(
      Object.fromEntries(
        familiesOf(
          { data: d, marks: [line], rowSelection: { channel: "a", data: "d" } } as ChartSpec,
          { tables: { d: given.get("e")! } },
        ),
      ),
    ).toEqual({ selection: "rowSelection", lineage: "rowSelection's lineage" });
  });

  it("bind stores through lineage as loadSpec binds them", async () => {
    const spec = {
      data: { ...d, e: { source: "d", groups: { by: ["g"], ops: { n: { op: "count" } } } } },
      marks: [{ type: "bar", data: "e", x: "g", y: "n" }],
      rowSelection: { channel: "a", data: "d" },
    } as ChartSpec;
    const loaded = await loadSpecWithFamilies(spec);
    const [binding] = loaded.config.rowSelection!.bindings;
    expect(binding!.lineage).toBe(lineage);
    expect(drawn(loaded.config)).toBe(drawn(loadSpec(spec).config));
    // A binding of the table the marks draw takes no reader.
    const direct = await loadSpecWithFamilies({
      data: d,
      marks: [line],
      rowSelection: { channel: "a" },
    });
    const [own] = direct.config.rowSelection!.bindings;
    expect(own!.lineage).toBeUndefined();
  });

  it("refuse a binding of a table no mark's rows come from as loadSpec does", async () => {
    const spec = {
      data: { ...d, other: { columns: { x: [1] } } },
      marks: [line],
      rowSelection: { channel: "a", data: "other" },
    } as ChartSpec;
    const message =
      'rowSelection store: line (mark 0) reads "d", whose rows no lineage connects to "other"; bind a store of "d" (channel "a")';
    expect(() => drawn(loadSpec(spec).config)).toThrow(message);
    const loaded = await loadSpecWithFamilies(spec);
    expect(() => drawn(loaded.config)).toThrow(message);
  });

  it("import each family once, however many specs need it at once", async () => {
    const imports = counted();
    const heatmap = { type: "heatmap", data: "d", x: "x", y: "g", color: "y" } as MarkSpec;
    const pie = { type: "pie", data: "d", category: "g", value: "y" } as MarkSpec;
    const specs = [[heatmap], [heatmap, pie], [line, heatmap], [pie]].map(
      (marks) => ({ data: d, marks }) as ChartSpec,
    );
    const loaded = await Promise.all(specs.map((spec) => loadPayload(encodePayload(spec))));
    expect(loaded.map(({ marks }) => marks.length)).toEqual([1, 2, 2, 1]);
    expect(Object.fromEntries(imports)).toEqual({ matrix: 1, layouts: 1 });
    // Specs after them import nothing.
    await loadSpecWithFamilies(specs[1]!);
    expect(Object.fromEntries(imports)).toEqual({ matrix: 1, layouts: 1 });
  });

  it("fail with the payload's message when a family does not load, and try again later", async () => {
    let failing = true;
    forgetFamilies((family, load) =>
      family === "matrix" && failing
        ? Promise.reject(new TypeError("Failed to fetch dynamically imported module"))
        : load(),
    );
    const contour = specOf("contour")!;
    const heatmap = specOf("heatmap")!;
    const [contourFailed, heatmapFailed, other] = await Promise.allSettled([
      loadSpecWithFamilies(contour),
      loadSpecWithFamilies(heatmap),
      loadSpecWithFamilies({ data: d, marks: [line] }),
    ]);
    // Each chart names its own mark, though one import failed for both.
    const reasonOf = (result: PromiseSettledResult<unknown>) =>
      (result as PromiseRejectedResult).reason as ChartError;
    expect(reasonOf(contourFailed!)).toBeInstanceOf(ChartError);
    expect(reasonOf(contourFailed!)).toMatchObject({
      code: "load-failed",
      phase: "load",
      message:
        'payload: the code of "contour" marks could not load (Failed to fetch dynamically imported module); check that the page serves every file of herceg\'s assets',
    });
    expect(reasonOf(heatmapFailed!).message).toMatch(/^payload: the code of "heatmap" marks/);
    expect(other!.status).toBe("fulfilled");
    failing = false;
    await expect(loadSpecWithFamilies(contour)).resolves.toBeDefined();
  });

  it("refuse a spec before loading any code for it", async () => {
    const imports = counted();
    const refused = {
      data: d,
      marks: [{ type: "heatmap", data: "d", x: "x", y: "g", color: "y", colr: "z" }],
    } as unknown as ChartSpec;
    await expect(loadSpecWithFamilies(refused)).rejects.toMatchObject({
      phase: "validate",
      path: "marks[0].colr",
    });
    expect(imports.size).toBe(0);
  });

  it("abort with the signal's reason while their code loads", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    forgetFamilies((_, load) => held.then(load));
    const controller = new AbortController();
    const spec = {
      data: d,
      marks: [{ type: "pie", data: "d", category: "g", value: "y" }],
    } as ChartSpec;
    const loading = loadSpecWithFamilies(spec, [], { signal: controller.signal });
    const reason = new Error("gone");
    controller.abort(reason);
    await expect(loading).rejects.toBe(reason);
    // The import goes on for other specs, which load once it is in.
    const later = loadSpecWithFamilies(spec);
    release();
    await expect(later).resolves.toBeDefined();
  });

  it("start no imports for a chart already gone, nor leave a failure after an abort unhandled", async () => {
    const pie = {
      data: d,
      marks: [{ type: "pie", data: "d", category: "g", value: "y" }],
    } as ChartSpec;
    const imports = counted();
    const gone = AbortSignal.abort(new Error("gone"));
    await expect(loadSpecWithFamilies(pie, [], { signal: gone })).rejects.toThrow("gone");
    expect(imports.size).toBe(0);
    // Aborted while its family loads, which then fails: only the abort is reported.
    let fail!: (error: Error) => void;
    forgetFamilies(() => new Promise((_, reject) => (fail = reject)));
    const controller = new AbortController();
    const loading = loadSpecWithFamilies(pie, [], { signal: controller.signal });
    controller.abort(new Error("unmounted"));
    await expect(loading).rejects.toThrow("unmounted");
    fail(new TypeError("Failed to fetch dynamically imported module"));
    // An unhandled rejection would fail this run.
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
});
