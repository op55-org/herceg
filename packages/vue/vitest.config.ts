import { defineConfig } from "vitest/config";
import { browserServer, browsers } from "../../scripts/browser/browsers.ts";
import { commands } from "../../scripts/browser/commands.ts";

const engine = (file: string) => new URL(`../herceg/src/${file}`, import.meta.url).pathname;

export default defineConfig({
  // Discovering dependencies mid-test can reload the page and lose module mocks.
  optimizeDeps: { include: ["vue", "vue/server-renderer"] },
  resolve: {
    alias: [
      // Exact matches, so "herceg" does not also rewrite "herceg/layout".
      { find: /^herceg$/, replacement: engine("index.ts") },
      { find: /^herceg\/layout$/, replacement: engine("layout.ts") },
      { find: /^herceg\/grid$/, replacement: engine("grid.ts") },
      { find: /^herceg\/grid\/remote$/, replacement: engine("grid-remote.ts") },
      { find: /^herceg\/grid\/pivot$/, replacement: engine("grid-pivot.ts") },
      { find: /^herceg\/grid\/memory$/, replacement: engine("grid-memory.ts") },
      { find: /^herceg\/pivot$/, replacement: engine("pivot.ts") },
      // Vue's full build compiles the tests' inline templates at runtime, as
      // an SFC compiler would at build time; its production build, as
      // applications ship it (the development build also keeps components
      // for its devtools for its first seconds on a page, which tests of
      // what is collected would see).
      { find: /^vue$/, replacement: "vue/dist/vue.esm-browser.prod.js" },
      // The server renderer of the SSR tests renders with that same runtime.
      { find: /^@vue\/runtime-dom$/, replacement: "vue/dist/vue.esm-browser.prod.js" },
    ],
  },
  // The flags the server renderer's bundler build reads, as a bundler defines them.
  define: {
    __VUE_OPTIONS_API__: "true",
    __VUE_PROD_DEVTOOLS__: "false",
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: "true",
  },
  test: {
    include: ["test/**/*.test.ts"],
    api: browserServer,
    browser: {
      enabled: true,
      headless: true,
      instances: browsers,
      // Garbage collection, for what grids' cells leave behind.
      commands,
    },
  },
});
