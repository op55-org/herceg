import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(import.meta.dirname, "..", "src");
// The chart engine must run without a DOM (servers, workers, Python exports).
const CORE = [
  "data",
  "fields",
  "geo",
  "grid",
  "scale",
  "format",
  "lod",
  "marks",
  "model",
  "scene",
  "spec",
  "three",
];
// The formats the lazy chunks write with, which they share.
const FORMATS = ["format/patterns.ts", "format/units.ts"];
// Keys' layout, which takes the text helpers it uses: bars' keys and display
// colors' come from the lazy chunks, points' and contours' from the marks,
// whose charts get it in a chunk of its own.
const KEYS = "marks/key-legend.ts";
// CSS colors as bytes, for heatmaps' display colors; static output reads them
// too, live charts' first chunks not.
const CSS_COLORS = "scale/css-color.ts";
// The display code (fields/compile.ts): what a chart loads for field displays
// and series named by parts, in a chunk of its own.
const DISPLAYS = [
  "fields/compile.ts",
  "fields/chart.ts",
  "fields/rules.ts",
  "fields/display.ts",
  "fields/check.ts",
  "fields/colors.ts",
  "fields/links.ts",
  "format/intl-options.ts",
  "guides/fields.ts",
  "marks/features/item-legends.ts",
  "marks/features/label-displays.ts",
  "marks/features/names.ts",
];
const DOM = /\b(document|window|HTMLElement|SVGElement|requestAnimationFrame|getComputedStyle)\b/;

function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(join(directory, entry.name)) : [join(directory, entry.name)],
  );
}

describe("architecture", () => {
  // A live chart loads the guide compiler when a configuration needs it. A
  // module both imported would move out of the chart's first chunk into a
  // chunk of its own (esbuild's splitting), so the compiler is handed what
  // it uses of the chart's code (GUIDE_KIT) and imports only types from it.
  // Legend swatches draw symbols with the markers' code, which the feature
  // compiler loads too: a chunk of the two compilers' own.
  it("the guide compiler imports only types from the chart's modules", () => {
    const shared = [
      ...FORMATS,
      "marks/features/markers.ts",
      "draw/symbol-shapes.ts",
      "layout/block.ts",
    ];
    const own = (path: string) =>
      (path.startsWith(join(SRC, "guides")) && path !== join(SRC, "guides/fields.ts")) ||
      shared.some((file) => path === join(SRC, file));
    for (const file of [
      ...files(join(SRC, "guides")).filter((file) => !file.endsWith("guides/fields.ts")),
      ...FORMATS.map((file) => join(SRC, file)),
    ]) {
      const source = readFileSync(file, "utf8");
      for (const [, path] of source.matchAll(/^import (?!type )[^;]*?from "([^"]+)"/gm))
        expect(own(resolve(dirname(file), path!)), `${file} imports ${path}`).toBe(true);
    }
  });

  // The display code loads only for charts that give fields or name series
  // by parts: the compilers take it from the chart, importing only its
  // types, and it imports only types from the chart's and the compilers'
  // modules but their formats and keys' layout. The tooltip content checks
  // its fields' formats with the Intl option lists alone, so it brings none
  // of it.
  it("the display code is a chunk of its own, which the compilers import only types of", () => {
    const displays = DISPLAYS.map((file) => join(SRC, file));
    const runtime = (file: string) =>
      [...readFileSync(file, "utf8").matchAll(/^import (?!type )[^;]*?from "([^"]+)"/gm)].map(
        ([, path]) => resolve(dirname(file), path!),
      );
    for (const file of displays)
      for (const path of runtime(file))
        expect(
          displays.includes(path) ||
            [...FORMATS, KEYS, CSS_COLORS].some((one) => path === join(SRC, one)),
          `${file} imports ${path}`,
        ).toBe(true);
    for (const file of [
      ...files(join(SRC, "guides")),
      ...files(join(SRC, "marks/features")),
      join(SRC, "dom/tooltip-content.ts"),
    ].filter((file) => !displays.includes(file)))
      for (const path of runtime(file))
        expect(
          !displays.includes(path) || path.endsWith("intl-options.ts"),
          `${file} imports ${path}`,
        ).toBe(true);
    const chart = runtime(join(SRC, "dom/chart.ts"));
    expect(chart.filter((path) => displays.includes(path))).toEqual([]);
  });

  // The feature compiler follows the same rule. What it imports besides its
  // own modules no line chart's module imports: expression compilation (the
  // builders `col` and `when` are data/expr.ts), symbols' shapes, automatic
  // padding's solver (for lines' markers), the guide compiler's pattern
  // formats, what channels draw (`outputProblem`), the placement of labels
  // following series and of text blocks, and the boxes bars' labels that
  // hide keep apart by (layout/label-boxes.ts), and keys' layout. Charts
  // that import these themselves (grids the first, points the second, third,
  // and last) get them in a chunk of their own.
  // Colors are told from names through the kit (FeatureKit.isColor).
  it("the feature compiler imports only types from the line chart's modules", () => {
    const features = join(SRC, "marks/features");
    const allowed = [
      ...FORMATS,
      KEYS,
      "data/expression.ts",
      "draw/symbol-shapes.ts",
      "model/clearance.ts",
      "spec/channels.ts",
      "layout/attached.ts",
      "layout/block.ts",
      "layout/label-boxes.ts",
      "draw/text-items.ts",
    ].map((path) => join(SRC, path));
    // Its modules of the display code import the rest of it (see below).
    const displays = DISPLAYS.map((path) => join(SRC, path));
    for (const file of files(features)) {
      const source = readFileSync(file, "utf8");
      for (const [, path] of source.matchAll(/^import (?!type )[^;]*?from "([^"]+)"/gm)) {
        const target = resolve(dirname(file), path!);
        expect(
          target.startsWith(features) ||
            allowed.includes(target) ||
            (displays.includes(file) && displays.includes(target)),
          `${file} imports ${path}`,
        ).toBe(true);
      }
    }
    const runtime = (file: string) =>
      [
        ...readFileSync(join(SRC, file), "utf8").matchAll(
          /^(?:import|export) (?!type )[^;]*?from "([^"]+)"/gm,
        ),
      ].map(([, path]) => resolve(dirname(join(SRC, file)), path!));
    for (const file of ["index.ts", "draw/text.ts", "draw/symbols.ts"])
      expect(
        runtime(file).filter(
          (path) => allowed.includes(path) && !path.endsWith("symbol-shapes.ts"),
        ),
        file,
      ).toEqual([]);
  });

  // Marks import their drawings, so drawings must load and write SVG without
  // a DOM. Canvas painting reaches the DOM only through the canvas it is
  // handed (rasters fall back to creating a canvas in its document).
  it("src/draw renders SVG without a DOM and paints only through its canvas", () => {
    for (const file of files(join(SRC, "draw"))) {
      const source = readFileSync(file, "utf8").replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, "");
      expect(DOM.test(source), `${file} uses a DOM global`).toBe(false);
      expect(/from "\.\.\/(dom|render)\//.test(source), `${file} imports browser code`).toBe(false);
      const reaches = source.match(/[\w.]*ownerDocument/g) ?? [];
      for (const reach of reaches)
        expect(reach, `${file} reaches the DOM other than through its canvas`).toBe(
          "context.canvas.ownerDocument",
        );
    }
  });

  // PDF export runs wherever the engine does, including the JavaScript engine
  // embedded in Python, which has no DOM or web APIs such as TextEncoder.
  it("PDF export uses no DOM or web APIs", () => {
    const render = join(SRC, "render");
    const modules = ["pdf.ts", "pdf-document.ts", "pdf-paper.ts", "pdf-fonts.ts", "deflate.ts"];
    for (const file of [
      join(SRC, "pdf.ts"),
      join(SRC, "scale/css-color.ts"),
      join(SRC, "draw/svg-path.ts"),
      ...modules.map((name) => join(render, name)),
    ]) {
      const source = readFileSync(file, "utf8").replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, "");
      // Types (the chart handle a mounted chart's export takes) load no code.
      const imports = [...source.matchAll(/^import (?!type )[^;]*?from "([^"]+)"/gm)].map(
        ([, path]) => path!,
      );
      const code = source.replace(/from "[^"]+"/g, "");
      expect(DOM.test(code), `${file} uses a DOM API`).toBe(false);
      expect(/\b(TextEncoder|btoa|atob|Blob|CompressionStream)\b/.test(code), file).toBe(false);
      for (const path of imports)
        expect(path, `${file} imports browser code`).not.toMatch(/\/dom\//);
    }
  });

  // `herceg/grid/model` runs without a DOM (servers, workers, tests in Node):
  // nothing it imports, however indirectly, may reach browser code.
  it("herceg/grid/model imports only DOM-free modules", () => {
    const seen = new Set<string>();
    const visit = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      const source = readFileSync(file, "utf8").replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, "");
      for (const [, path] of source.matchAll(/from "(\.[^"]+)"/g))
        visit(resolve(dirname(file), path!));
    };
    visit(join(SRC, "grid", "model.ts"));
    for (const file of seen) {
      const directory = file.slice(SRC.length + 1).split("/")[0]!;
      expect(CORE, `herceg/grid/model reaches ${file}`).toContain(directory);
    }
  });

  // `herceg/pivot` is data: charts read its tables, and grids load it only to show one.
  it("herceg/pivot imports only the data layer", () => {
    const seen = new Set<string>();
    const visit = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      const source = readFileSync(file, "utf8").replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, "");
      for (const [, path] of source.matchAll(/from "(\.[^"]+)"/g))
        visit(resolve(dirname(file), path!));
    };
    visit(join(SRC, "pivot.ts"));
    for (const file of seen) {
      const directory = file.slice(SRC.length + 1).split("/")[0]!;
      expect(["pivot.ts", "data", "lod"], `herceg/pivot reaches ${file}`).toContain(directory);
    }
  });

  for (const directory of CORE) {
    it(`src/${directory} does not use the DOM or import browser code`, () => {
      for (const file of files(join(SRC, directory))) {
        const source = readFileSync(file, "utf8").replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, "");
        expect(DOM.test(source), `${file} uses a DOM API`).toBe(false);
        expect(/from "\.\.\/(dom|render)\//.test(source), `${file} imports browser code`).toBe(
          false,
        );
      }
    });
  }
});
