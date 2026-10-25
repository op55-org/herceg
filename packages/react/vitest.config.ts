import { defineConfig } from "vitest/config";
import { browserServer, browsers } from "../../scripts/browser/browsers.ts";
import { commands } from "../../scripts/browser/commands.ts";

const engine = (file: string) => new URL(`../herceg/src/${file}`, import.meta.url).pathname;

export default defineConfig({
  // Prebundle every entry used by the tests, including the JSX transform.
  // Discovering dependencies mid-test can reload the page and lose module mocks.
  optimizeDeps: {
    include: ["react", "react/jsx-runtime", "react-dom", "react-dom/client", "react-dom/server"],
  },
  resolve: {
    // Exact matches, so "herceg" does not also rewrite "herceg/grid".
    alias: [
      { find: /^herceg$/, replacement: engine("index.ts") },
      { find: /^herceg\/grid$/, replacement: engine("grid.ts") },
      { find: /^herceg\/layout$/, replacement: engine("layout.ts") },
    ],
  },
  test: {
    include: ["test/**/*.test.tsx"],
    // The dashboard's tests drag with the mouse, which Firefox captures only once it has been over the page.
    setupFiles: ["../../scripts/browser/setup.ts"],
    api: browserServer,
    browser: {
      enabled: true,
      headless: true,
      instances: browsers,
      // Real input, for the dashboard in a scrolling page.
      commands,
    },
  },
});
