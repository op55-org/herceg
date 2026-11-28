import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import { type PageServer, serve as servePages, type Throttle } from "./server.ts";
import { svelte } from "./svelte.ts";

export { ISOLATION } from "./server.ts";

export const ROOT = fileURLToPath(new URL("../..", import.meta.url));
/** Herceg is bundled from source so benchmarks always measure the working tree. */
export const HERCEG_ALIAS = {
  herceg: join(ROOT, "..", "packages", "herceg", "src", "index.ts"),
  "herceg/pdf": join(ROOT, "..", "packages", "herceg", "src", "pdf.ts"),
  "herceg/image": join(ROOT, "..", "packages", "herceg", "src", "image.ts"),
  "herceg/fonts": join(ROOT, "..", "packages", "herceg", "src", "fonts.ts"),
  "herceg/fields": join(ROOT, "..", "packages", "herceg", "src", "fields.ts"),
  "herceg/spec": join(ROOT, "..", "packages", "herceg", "src", "from-spec.ts"),
  "herceg/grid": join(ROOT, "..", "packages", "herceg", "src", "grid.ts"),
  "herceg/layout": join(ROOT, "..", "packages", "herceg", "src", "layout.ts"),
  "herceg/grid/pivot": join(ROOT, "..", "packages", "herceg", "src", "grid-pivot.ts"),
  "herceg/grid/remote": join(ROOT, "..", "packages", "herceg", "src", "grid-remote.ts"),
  "herceg/grid/memory": join(ROOT, "..", "packages", "herceg", "src", "grid-memory.ts"),
  "herceg/pivot": join(ROOT, "..", "packages", "herceg", "src", "pivot.ts"),
  "herceg/web": join(ROOT, "..", "packages", "herceg", "src", "web.ts"),
  "@herceg/react": join(ROOT, "..", "packages", "react", "src", "index.ts"),
  "@herceg/react/grid": join(ROOT, "..", "packages", "react", "src", "grid.tsx"),
  "@herceg/react/grid/remote": join(ROOT, "..", "packages", "react", "src", "grid", "remote.tsx"),
  "@herceg/react/grid/pivot": join(ROOT, "..", "packages", "react", "src", "grid", "pivot.tsx"),
  "@herceg/react/layout": join(ROOT, "..", "packages", "react", "src", "layout.tsx"),
  "@herceg/vue": join(ROOT, "..", "packages", "vue", "src", "index.ts"),
  "@herceg/vue/grid": join(ROOT, "..", "packages", "vue", "src", "grid.ts"),
  "@herceg/vue/grid/remote": join(ROOT, "..", "packages", "vue", "src", "grid", "remote.ts"),
  "@herceg/vue/grid/pivot": join(ROOT, "..", "packages", "vue", "src", "grid", "pivot.ts"),
  "@herceg/svelte": join(ROOT, "..", "packages", "svelte", "src", "index.ts"),
  "@herceg/svelte/grid": join(ROOT, "..", "packages", "svelte", "src", "grid.ts"),
  "@herceg/svelte/grid/remote": join(ROOT, "..", "packages", "svelte", "src", "grid", "remote.ts"),
  "@herceg/svelte/grid/pivot": join(ROOT, "..", "packages", "svelte", "src", "grid", "pivot.ts"),
};
const OUT = join(ROOT, ".build");

/**
 * The chart harness and adapters, or the grid harness and grid adapters.
 * `first` is imported before the adapter, so it runs before library code:
 * the input listeners that hear every event first, and the WebGL tracking.
 */
const SUITES: Record<
  "charts" | "grid",
  { adapters: string; harness: string; install: string; first?: string[] }
> = {
  charts: {
    adapters: "./src/adapters",
    harness: "./src/page/harness.ts",
    install: "installHarness",
    first: ["./src/page/input.ts", "./src/page/webgl.ts"],
  },
  grid: {
    adapters: "./src/grid/adapters",
    harness: "./src/grid/harness.ts",
    install: "installGridHarness",
  },
};

/**
 * Production bundle of a harness plus one adapter, so each page loads one
 * library. Grid pages are named `grid-<library>`.
 */
export async function buildPage(
  library: string,
  suite: keyof typeof SUITES = "charts",
): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const { adapters, harness, install, first } = SUITES[suite];
  const name = suite === "grid" ? `grid-${library}` : library;
  await esbuild.build({
    stdin: {
      contents: [
        ...(first ?? []).map((module) => `import "${module}";`),
        `import { adapter } from "${adapters}/${library}";`,
        `import { ${install} } from "${harness}";`,
        `${install}(adapter);`,
      ].join("\n"),
      resolveDir: ROOT,
      sourcefile: `${name}-entry.ts`,
      loader: "ts",
    },
    bundle: true,
    minify: true,
    format: "esm",
    target: "es2022",
    outfile: join(OUT, `${name}.js`),
    // Vue's flags as an application's build sets them (Vite's defaults).
    define: {
      "process.env.NODE_ENV": '"production"',
      __VUE_OPTIONS_API__: "true",
      __VUE_PROD_DEVTOOLS__: "false",
      __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: "false",
    },
    jsx: "automatic",
    alias: HERCEG_ALIAS,
    plugins: [svelte],
    logLevel: "warning",
  });
}

function page(library: string): string {
  const css = existsSync(join(OUT, `${library}.css`))
    ? `<link rel="stylesheet" href="/${library}.css">`
    : "";
  return `<!doctype html>
<html><head><meta charset="utf-8">${css}
<style>body{margin:0;font:14px system-ui,sans-serif}#stage{line-height:0}</style>
</head><body><div id="stage"></div><script type="module" src="/${library}.js"></script></body></html>`;
}

/** Serves the built pages (`/<library>.html`) and their assets; see server.ts. */
export function serve(options: { throttle?: Throttle; host?: string } = {}): Promise<PageServer> {
  return servePages(OUT, page, options);
}
