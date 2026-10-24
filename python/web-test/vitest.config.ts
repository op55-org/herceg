// Web pages served by Flask (app.py), in Chrome, Firefox, and WebKit:
// `npm run test:python-web`. HERCEG_BROWSERS picks some, as for the
// browser tests.
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: new URL(".", import.meta.url).pathname,
  test: {
    include: ["*.test.ts"],
    environment: "node",
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
