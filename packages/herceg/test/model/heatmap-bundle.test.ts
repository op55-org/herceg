import { resolve } from "node:path";
import { build, type Metafile } from "esbuild";
import { expect, it } from "vitest";

const index = resolve(import.meta.dirname, "../../src/index.ts");
const entries = resolve(import.meta.dirname, "../../../../benchmarks/src/size/entries");

type Outputs = Metafile["outputs"];

/** The chunks a page loads before `main` runs: it and what it imports statically, through and through. */
function initialChunks(outputs: Outputs, main: string): Set<string> {
  const initial = new Set<string>();
  const visit = (path: string) => {
    if (initial.has(path)) return;
    initial.add(path);
    for (const imported of outputs[path]!.imports)
      if (imported.kind === "import-statement" && outputs[imported.path]) visit(imported.path);
  };
  visit(main);
  return initial;
}

/** The modules a chunk holds code of. */
function modulesOf(outputs: Outputs, path: string): string[] {
  return Object.entries(outputs[path]!.inputs)
    .filter(([, input]) => input.bytesInOutput > 0)
    .map(([module]) => module);
}

/** What follows heatmaps' changes, loaded on their first change. */
const FOLLOWING = [
  "/marks/heatmap-patch.ts",
  "/marks/heatmap-image-patch.ts",
  "/marks/cell-counts.ts",
  "/data/changes.ts",
];

it.each(["herceg-heatmap", "herceg-lineage", "herceg-line"])(
  "leaves what follows heatmaps' changes out of the %s entry's first chunks",
  async (name) => {
    const result = await build({
      entryPoints: [resolve(entries, `${name}.ts`)],
      bundle: true,
      minify: true,
      format: "esm",
      platform: "browser",
      target: "es2022",
      define: { "process.env.NODE_ENV": '"production"' },
      alias: { herceg: index },
      outdir: "out",
      splitting: true,
      write: false,
      metafile: true,
    });
    const outputs = result.metafile!.outputs;
    const main = Object.keys(outputs).find((path) => path.endsWith(`/${name}.js`))!;
    const first = initialChunks(outputs, main);
    const initial = [...first].flatMap((path) => modulesOf(outputs, path));
    for (const module of FOLLOWING)
      expect(
        initial.some((path) => path.endsWith(module)),
        module,
      ).toBe(false);
    // It is in a chunk of its own, loaded on the first change.
    const holding = Object.keys(outputs).filter((path) =>
      modulesOf(outputs, path).some((module) => module.endsWith("/marks/heatmap-patch.ts")),
    );
    expect(holding).toHaveLength(1);
    // Importing no first chunk: what it shared with them would be split out
    // of the chunk holding it into one more, though pages without heatmaps
    // never load it.
    const shared = outputs[holding[0]!]!.imports.filter(
      (imported) => imported.kind === "import-statement" && first.has(imported.path),
    );
    expect(shared.map((imported) => modulesOf(outputs, imported.path))).toEqual([]);
  },
);
