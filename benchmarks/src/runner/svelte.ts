// Compiles Svelte for production in esbuild builds, as an application's
// build would: components (`.svelte`), and modules using runes
// (`.svelte.ts`, `.svelte.js`), their types stripped first.

import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import * as esbuild from "esbuild";
import { compile, compileModule } from "svelte/compiler";

export const svelte: esbuild.Plugin = {
  name: "svelte",
  setup(build) {
    build.onLoad({ filter: /\.svelte$/ }, ({ path }) => ({
      contents: compile(readFileSync(path, "utf8"), { filename: path }).js.code,
      loader: "js",
      resolveDir: dirname(path),
    }));
    build.onLoad({ filter: /\.svelte\.[jt]s$/ }, async ({ path }) => {
      const { code } = await esbuild.transform(readFileSync(path, "utf8"), {
        loader: path.endsWith(".ts") ? "ts" : "js",
        sourcefile: path,
      });
      return {
        contents: compileModule(code, { filename: path }).js.code,
        loader: "js",
        resolveDir: dirname(path),
      };
    });
  },
};
