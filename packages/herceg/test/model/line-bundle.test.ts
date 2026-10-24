import { resolve } from "node:path";
import { build, type Metafile } from "esbuild";
import { expect, it } from "vitest";

const entry = resolve(
  import.meta.dirname,
  "../../../../benchmarks/src/size/entries/herceg-line.ts",
);
const index = resolve(import.meta.dirname, "../../src/index.ts");

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

it.each(["plain", "facets", "breaks"])(
  "the %s line entry loads point-view copying only with its placement provider",
  async (provider) => {
    const result = await build({
      ...(provider === "plain"
        ? { entryPoints: [entry] }
        : {
            stdin: {
              resolveDir: import.meta.dirname,
              contents: `
                import { createChart, line, table, time, facet, timeBreaks } from "herceg";
                export function render(element, x, y, groups) {
                  const data = table({ t: time(x), v: y, g: groups });
                  return createChart(element, {
                    marks: [line(data, { x: "t", y: "v" })],
                    ${provider === "facets" ? 'facet: facet("g")' : 'x: { breaks: timeBreaks([{ weekdays: ["sat", "sun"] }]) }'}
                  });
                }
              `,
            },
          }),
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
    const included = [
      ...initialChunks(
        outputs,
        Object.keys(outputs).find((path) =>
          provider === "plain"
            ? path.endsWith("/herceg-line.js")
            : outputs[path]!.entryPoint === "<stdin>",
        )!,
      ),
    ].flatMap((path) => modulesOf(outputs, path));
    expect(included.some((path) => path.endsWith("/lod/point-view.ts"))).toBe(provider !== "plain");
    expect(included.some((path) => path.endsWith("/marks/swarm.ts"))).toBe(false);
  },
);

it("keeps the brush's selection rules in the chart's own chunk, splitting none out for them", async () => {
  const result = await build({
    entryPoints: [entry],
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
  const main = Object.keys(outputs).find((path) => path.endsWith("/herceg-line.js"))!;
  // The brush, loaded later, is handed the rules rather than importing them.
  const holding = Object.keys(outputs).filter((path) =>
    modulesOf(outputs, path).some((module) => module.endsWith("/dom/brushed.ts")),
  );
  expect(holding).toEqual([main]);
});
