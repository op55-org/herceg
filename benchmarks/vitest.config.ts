import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

const source = (path: string) => new URL(`../packages/${path}`, import.meta.url).pathname;

export default defineConfig({
  root: new URL(".", import.meta.url).pathname,
  resolve: {
    // Exact matches, so "herceg" does not also rewrite "herceg/pdf".
    alias: [
      { find: /^herceg$/, replacement: source("herceg/src/index.ts") },
      { find: /^herceg\/pdf$/, replacement: source("herceg/src/pdf.ts") },
      { find: /^herceg\/fonts$/, replacement: source("herceg/src/fonts.ts") },
      { find: /^@herceg\/react$/, replacement: source("react/src/index.ts") },
    ],
  },
  // Prebundled up front: discovered mid-run, they would reload the page under the tests.
  optimizeDeps: {
    include: [
      "echarts",
      "chart.js/auto",
      "chartjs-adapter-date-fns",
      "plotly.js-dist-min",
      "d3-scale",
      "react",
      "react-dom/client",
      "@tanstack/charts",
      "@tanstack/charts/canvas",
      "@tanstack/charts/cursor",
      "@tanstack/charts/export",
      "@tanstack/charts/interaction/signal",
      "@tanstack/charts/interaction/zoom",
      "@tanstack/charts/react",
      "@tanstack/charts/react/tooltip",
      "@tanstack/charts/scales/band",
      "@tanstack/charts/scales/linear",
      "@tanstack/charts/tooltip",
    ],
  },
  test: {
    projects: [
      {
        // The harness's own logic, in Node: seeded order, memory ratios, rows' results, the page server, the WebDriver client.
        extends: true,
        test: {
          name: "unit",
          include: [
            "src/runner/order.test.ts",
            "src/runner/ratios.test.ts",
            "src/runner/results.test.ts",
            "src/runner/server.test.ts",
            "src/device/webdriver.test.ts",
          ],
          environment: "node",
        },
      },
      {
        // The driver's input in Chrome, Firefox, and WebKit, each launched as the runners launch them.
        extends: true,
        test: {
          name: "driver",
          include: ["src/runner/input.test.ts"],
          environment: "node",
          testTimeout: 60_000,
        },
      },
      {
        // In Chrome: the common-task samples (src/ease), each of which mounts
        // and draws; the interaction benchmark's checks
        // (src/interaction/checks.ts); and the page harness's verified frames
        // and checks against broken adapters (src/page).
        extends: true,
        test: {
          name: "browser",
          include: [
            "src/ease/**/*.test.tsx",
            "src/interaction/**/*.test.ts",
            "src/page/**/*.test.ts",
          ],
          browser: {
            enabled: true,
            headless: true,
            // Chrome only: these check that the samples' code stays valid and draws;
            // the library's own suites cover Firefox and WebKit (scripts/browser).
            provider: playwright({ launchOptions: { channel: "chrome" } }),
            instances: [{ browser: "chromium" }],
            // Room for the 800 px charts, which the default 414 px viewport would cut off.
            viewport: { width: 1024, height: 900 },
          },
        },
      },
    ],
  },
});
