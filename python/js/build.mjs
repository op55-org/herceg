// Bundles the JavaScript the Python package ships: `npm run build:python`.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

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
// statically (preloaded), and every file, lazy chunks included.
const web = join(out, "web");
rmSync(web, { recursive: true, force: true });
const { metafile } = await esbuild.build({
  ...common,
  entryPoints: [join(here, "web.ts")],
  format: "esm",
  splitting: true,
  outdir: web,
  entryNames: "[name]-[hash]",
  chunkNames: "[name]-[hash]",
  metafile: true,
});
const outputs = Object.entries(metafile.outputs);
// Chunks loaded with import() are entry points too; the page loads this one.
const [entry] = outputs.find(([, output]) => output.entryPoint?.endsWith("python/js/web.ts"));
const preload = new Set();
const visit = (path) => {
  for (const { path: imported, kind } of metafile.outputs[path].imports)
    if (kind === "import-statement" && !preload.has(imported)) {
      preload.add(imported);
      visit(imported);
    }
};
visit(entry);
const names = (paths) => [...paths].map((path) => basename(path)).sort();
writeFileSync(
  join(web, "manifest.json"),
  `${JSON.stringify({ entry: basename(entry), preload: names(preload), files: names(outputs.map(([path]) => path)) }, null, 2)}\n`,
);
