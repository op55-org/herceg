// Bundles the JavaScript the Python package ships: `npm run build:python`.
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import { build as rolldown } from "rolldown";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "src", "herceg", "static");
mkdirSync(out, { recursive: true });
const engine = join(here, "..", "..", "packages", "herceg", "src");
const common = {
  bundle: true,
  minify: true,
  target: "es2022",
  alias: {
    herceg: join(engine, "index.ts"),
    "herceg/pdf": join(engine, "pdf.ts"),
    "herceg/fonts": join(engine, "fonts.ts"),
    "herceg/spec": join(engine, "from-spec.ts"),
    "herceg/web": join(engine, "web.ts"),
  },
  logLevel: "warning",
};
// The spec's JSON Schema, which `hg.spec_schema()` reads.
copyFileSync(
  join(here, "..", "..", "packages", "herceg", "spec.schema.json"),
  join(out, "spec.schema.json"),
);
// Browsers: a classic script defining `hercegPython.render`, so each chart's
// HTML can inline it. The WebGL painter is inlined rather than split.
await esbuild.build({
  ...common,
  entryPoints: [join(here, "browser.ts")],
  format: "iife",
  globalName: "hercegPython",
  outfile: join(out, "herceg.js"),
});
// Embedded engines: a classic script defining `hercegStatic`.
await esbuild.build({
  ...common,
  entryPoints: [join(here, "static.ts")],
  format: "iife",
  platform: "neutral",
  outfile: join(out, "herceg-static.js"),
});
// Notebook widgets and Streamlit components: ES modules, as anywidget and
// Streamlit load them.
for (const name of ["widget", "streamlit"]) {
  await esbuild.build({
    ...common,
    entryPoints: [join(here, `${name}.ts`)],
    format: "esm",
    outfile: join(out, `herceg-${name}.js`),
  });
}
// Web pages: an ES module and the chunks it imports, each named by a hash of
// its content (and so of what it imports), served with long-lived caching
// (herceg.web.assets()). The manifest lists the entry, the chunks it imports
// statically (preloaded), and every file, lazy chunks included. Rolldown
// builds them, as it can keep in one chunk every module the page loads at
// once: esbuild splits those by which lazy chunks share them (46 files, not
// 2, to fetch before the first frame). Marks of families the page's charts
// do not draw, and what charts load later, stay chunks of their own.
const web = join(out, "web");
rmSync(web, { recursive: true, force: true });
const input = {
  input: join(here, "web.ts"),
  resolve: { alias: common.alias },
  transform: { target: common.target },
  platform: "browser",
  logLevel: "warn",
};
/** The chunks the entry imports statically, transitively, of a build's output. */
const initial = (output) => {
  const chunks = new Map(
    output.filter((file) => file.type === "chunk").map((c) => [c.fileName, c]),
  );
  const found = new Set();
  const visit = (name) => {
    if (found.has(name)) return;
    found.add(name);
    for (const imported of chunks.get(name).imports) visit(imported);
  };
  visit([...chunks.values()].find((chunk) => chunk.isEntry).fileName);
  return [...found].map((name) => chunks.get(name));
};
/**
 * A chunk's import of a lazy chunk imports, as it starts, every chunk that
 * one imports statically beyond what the page loads at once: a browser finds
 * a module's imports only once it has it, so a family's shared code would
 * otherwise take a round trip for each level of chunks it imports. They are
 * imports rather than `modulepreload` links so that they are fetched as the
 * import fetches them, with the page's nonce and credentials. It rewrites
 * chunks before they are minified and hashed, so a chunk's name covers it.
 */
const importLazyChunksAtOnce = {
  name: "import-lazy-chunks-at-once",
  renderChunk(code, chunk, _, { chunks }) {
    // Names here are placeholders, which Rolldown replaces with the hashed ones.
    const page = new Set(initial(Object.values(chunks)).map((each) => each.fileName));
    const lazyImports = (name, found = new Set()) => {
      for (const imported of chunks[name].imports)
        if (!page.has(imported) && !found.has(imported)) {
          found.add(imported);
          lazyImports(imported, found);
        }
      return found;
    };
    // What the importing chunk has already: it and its own imports.
    const loaded = lazyImports(chunk.fileName).add(chunk.fileName);
    let rewritten = 0;
    const result = code.replace(/import\((["'`])\.\/([^"'`]+)\1\)/g, (call, _, name) => {
      if (!chunks[name]) return call;
      const files = [...lazyImports(name)].filter((file) => !loaded.has(file));
      if (files.length === 0) return call;
      rewritten++;
      // The import of `name` reports a failure; these need not.
      const early = files.map((file) => `import("./${file}")`).join(",");
      return `(Promise.all([${early}]).catch(()=>{}),${call})`;
    });
    return rewritten === 0 ? null : result;
  },
};
// The modules the page loads at once, as Rolldown splits them by itself.
const first = await rolldown({ ...input, output: { format: "esm" }, write: false });
const eager = new Set(initial(first.output).flatMap((chunk) => chunk.moduleIds));
const { output } = await rolldown({
  ...input,
  plugins: [importLazyChunksAtOnce],
  output: {
    dir: web,
    format: "esm",
    minify: true,
    entryFileNames: "[name]-[hash].js",
    // Lazy chunks are named for what they load (matrix, interaction), the others by hash.
    chunkFileNames: (chunk) => (chunk.isDynamicEntry ? "[name]-[hash].js" : "chunk-[hash].js"),
    codeSplitting: { groups: [{ name: "page", test: (id) => eager.has(id) }] },
  },
  write: true,
});
const entry = output.find((file) => file.type === "chunk" && file.isEntry).fileName;
const preload = initial(output).flatMap(({ fileName }) => (fileName === entry ? [] : [fileName]));
writeFileSync(
  join(web, "manifest.json"),
  `${JSON.stringify({ entry, preload: preload.sort(), files: output.map((file) => file.fileName).sort() }, null, 2)}\n`,
);
