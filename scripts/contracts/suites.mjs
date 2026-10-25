// The test suites whose reports prove contracts: each run by its command
// through scripts/contracts/run.mjs, which leaves its report and a run
// record in tmp/contracts/<source>/ (see source.mjs).

/** Browser engines every browser suite must pass in, as scripts/browser/browsers.ts runs them. */
export const ENGINES = ["chromium", "firefox", "webkit"];

/**
 * Each suite: the command that runs it from the repository root, and where
 * its tests run ("node", "browser", or "python").
 */
export const SUITES = {
  "herceg-unit": { command: "npm test", runs: "node" },
  "herceg-browser": { command: "npm run test:browser -w herceg", runs: "browser" },
  react: { command: "npm run test:browser -w @herceg/react", runs: "browser" },
  vue: { command: "npm run test:browser -w @herceg/vue", runs: "browser" },
  svelte: { command: "npm run test:browser -w @herceg/svelte", runs: "browser" },
  "python-js": { command: "npm run test:browser (python/js)", runs: "browser" },
  python: { command: "npm run test:python", runs: "python" },
  "python-web": { command: "npm run test:python-web", runs: "browser" },
};
